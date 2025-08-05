const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const QRCode = require('qrcode');
const ldap = require('ldapjs');
const cors = require('cors');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuration
const JWT_SECRET = 'graviti_secret_key_2024';
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Database initialization
const db = new sqlite3.Database('./data/tickets.db');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        password TEXT,
        role TEXT DEFAULT 'user',
        department TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tickets table
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_type TEXT,
        severity TEXT,
        supervisor_email TEXT,
        location TEXT,
        employee_id TEXT,
        description TEXT,
        status TEXT DEFAULT 'open',
        assigned_to TEXT,
        requestor TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        time_to_resolve INTEGER DEFAULT 72,
        closed_at DATETIME,
        department TEXT
    )`);

    // Attachments table
    db.run(`CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER,
        filename TEXT,
        original_name TEXT,
        path TEXT,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id)
    )`);

    // Comments table
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER,
        user_id INTEGER,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT DEFAULT 'Graviti Pharmaceuticals',
        logo_path TEXT DEFAULT '/images/default-logo.png',
        ldap_url TEXT,
        ldap_base_dn TEXT,
        ldap_bind_dn TEXT,
        ldap_bind_password TEXT,
        email_host TEXT,
        email_port INTEGER,
        email_user TEXT,
        email_password TEXT
    )`);

    // Insert default admin user
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (username, email, password, role, department) 
            VALUES ('admin', 'admin@graviti.com', ?, 'admin', 'IT')`, [defaultPassword]);

    // Insert default settings
    db.run(`INSERT OR IGNORE INTO settings (id, company_name) VALUES (1, 'Graviti Pharmaceuticals')`);
});

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Email configuration
let transporter = nodemailer.createTransporter({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'your-email@gmail.com',
        pass: 'your-app-password'
    }
});

// LDAP configuration
let ldapClient = null;

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Routes

// Generate QR Code for ticket system access
app.get('/api/qr-code', async (req, res) => {
    try {
        const qrData = await QRCode.toDataURL(SERVER_URL);
        res.json({ qrCode: qrData, url: SERVER_URL });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Authentication routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // First try LDAP authentication
        if (ldapClient) {
            try {
                const ldapUser = await authenticateLDAP(username, password);
                if (ldapUser) {
                    // Create or update user in local database
                    const token = jwt.sign({ 
                        username: ldapUser.username, 
                        email: ldapUser.email, 
                        role: 'user' 
                    }, JWT_SECRET);
                    return res.json({ token, user: ldapUser });
                }
            } catch (ldapError) {
                console.log('LDAP authentication failed, trying local auth');
            }
        }

        // Fall back to local authentication
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!user) return res.status(401).json({ error: 'Invalid credentials' });

            bcrypt.compare(password, user.password, (err, result) => {
                if (result) {
                    const token = jwt.sign({ 
                        id: user.id,
                        username: user.username, 
                        email: user.email, 
                        role: user.role 
                    }, JWT_SECRET);
                    
                    // Check if this is first login for admin
                    if (user.username === 'admin' && password === 'admin123') {
                        res.json({ token, user, firstLogin: true });
                    } else {
                        res.json({ token, user });
                    }
                } else {
                    res.status(401).json({ error: 'Invalid credentials' });
                }
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Change default admin password
app.post('/api/change-admin-password', authenticateToken, (req, res) => {
    const { newPassword } = req.body;
    
    if (req.user.username !== 'admin') {
        return res.status(403).json({ error: 'Only admin can change admin password' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.run('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, 'admin'], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update password' });
        res.json({ message: 'Password updated successfully' });
    });
});

// Create ticket
app.post('/api/tickets', authenticateToken, upload.array('attachments'), [
    body('ticket_type').notEmpty().withMessage('Ticket type is required'),
    body('severity').isIn(['High', 'Medium', 'Low']).withMessage('Invalid severity'),
    body('description').notEmpty().withMessage('Description is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        ticket_type,
        severity,
        supervisor_email,
        location,
        employee_id,
        description
    } = req.body;

    const ticketData = {
        ticket_type,
        severity,
        supervisor_email,
        location,
        employee_id,
        description,
        requestor: req.user.username
    };

    db.run(`INSERT INTO tickets (ticket_type, severity, supervisor_email, location, employee_id, description, requestor)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ticket_type, severity, supervisor_email, location, employee_id, description, req.user.username],
        function(err) {
            if (err) return res.status(500).json({ error: 'Failed to create ticket' });

            const ticketId = this.lastID;

            // Handle attachments
            if (req.files && req.files.length > 0) {
                req.files.forEach(file => {
                    db.run('INSERT INTO attachments (ticket_id, filename, original_name, path) VALUES (?, ?, ?, ?)',
                        [ticketId, file.filename, file.originalname, file.path]);
                });
            }

            // Send email notification to supervisor
            if (supervisor_email) {
                sendEmailNotification(supervisor_email, ticketId, ticketData);
            }

            // Emit socket event for real-time updates
            io.emit('newTicket', { id: ticketId, ...ticketData });

            res.json({ 
                message: 'Ticket created successfully', 
                ticketId,
                ticket: { id: ticketId, ...ticketData }
            });
        });
});

// Get all tickets
app.get('/api/tickets', authenticateToken, (req, res) => {
    const { status, assigned_to, department, severity } = req.query;
    
    let query = 'SELECT * FROM tickets WHERE 1=1';
    let params = [];

    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }
    if (assigned_to) {
        query += ' AND assigned_to = ?';
        params.push(assigned_to);
    }
    if (department) {
        query += ' AND department = ?';
        params.push(department);
    }
    if (severity) {
        query += ' AND severity = ?';
        params.push(severity);
    }

    // Non-admin users can only see their own tickets
    if (req.user.role !== 'admin') {
        query += ' AND requestor = ?';
        params.push(req.user.username);
    }

    query += ' ORDER BY created_at DESC';

    db.all(query, params, (err, tickets) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch tickets' });
        res.json(tickets);
    });
});

// Get single ticket
app.get('/api/tickets/:id', authenticateToken, (req, res) => {
    const ticketId = req.params.id;
    
    db.get(`SELECT t.*, GROUP_CONCAT(a.original_name) as attachments 
            FROM tickets t 
            LEFT JOIN attachments a ON t.id = a.ticket_id 
            WHERE t.id = ?`, [ticketId], (err, ticket) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch ticket' });
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        // Check access permissions
        if (req.user.role !== 'admin' && ticket.requestor !== req.user.username) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get comments
        db.all(`SELECT c.*, u.username FROM comments c 
                JOIN users u ON c.user_id = u.id 
                WHERE c.ticket_id = ? ORDER BY c.created_at`, [ticketId], (err, comments) => {
            if (err) comments = [];
            ticket.comments = comments;
            res.json(ticket);
        });
    });
});

// Update ticket status
app.put('/api/tickets/:id/status', authenticateToken, (req, res) => {
    const { status, assigned_to } = req.body;
    const ticketId = req.params.id;

    let query = 'UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP';
    let params = [status];

    if (assigned_to) {
        query += ', assigned_to = ?';
        params.push(assigned_to);
    }

    if (status === 'closed') {
        query += ', closed_at = CURRENT_TIMESTAMP';
    }

    query += ' WHERE id = ?';
    params.push(ticketId);

    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ error: 'Failed to update ticket' });
        
        // Emit socket event for real-time updates
        io.emit('ticketUpdated', { id: ticketId, status, assigned_to });
        
        res.json({ message: 'Ticket updated successfully' });
    });
});

// Assign ticket
app.put('/api/tickets/:id/assign', authenticateToken, requireAdmin, (req, res) => {
    const { assigned_to } = req.body;
    const ticketId = req.params.id;

    db.run('UPDATE tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [assigned_to, ticketId], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to assign ticket' });
            
            io.emit('ticketAssigned', { id: ticketId, assigned_to });
            res.json({ message: 'Ticket assigned successfully' });
        });
});

// Update ticket severity
app.put('/api/tickets/:id/severity', authenticateToken, requireAdmin, (req, res) => {
    const { severity } = req.body;
    const ticketId = req.params.id;

    db.run('UPDATE tickets SET severity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [severity, ticketId], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to update severity' });
            
            io.emit('severityUpdated', { id: ticketId, severity });
            res.json({ message: 'Severity updated successfully' });
        });
});

// Reopen ticket
app.put('/api/tickets/:id/reopen', authenticateToken, (req, res) => {
    const ticketId = req.params.id;

    // Check if user owns the ticket
    db.get('SELECT requestor FROM tickets WHERE id = ?', [ticketId], (err, ticket) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        
        if (req.user.role !== 'admin' && ticket.requestor !== req.user.username) {
            return res.status(403).json({ error: 'Access denied' });
        }

        db.run('UPDATE tickets SET status = ?, closed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['open', ticketId], function(err) {
                if (err) return res.status(500).json({ error: 'Failed to reopen ticket' });
                
                io.emit('ticketReopened', { id: ticketId });
                res.json({ message: 'Ticket reopened successfully' });
            });
    });
});

// Add comment to ticket
app.post('/api/tickets/:id/comments', authenticateToken, (req, res) => {
    const { comment } = req.body;
    const ticketId = req.params.id;

    db.run('INSERT INTO comments (ticket_id, user_id, comment) VALUES (?, ?, ?)',
        [ticketId, req.user.id, comment], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to add comment' });
            
            io.emit('commentAdded', { ticketId, comment, username: req.user.username });
            res.json({ message: 'Comment added successfully' });
        });
});

// User management (Admin only)
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
    db.all('SELECT id, username, email, role, department, created_at FROM users', (err, users) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch users' });
        res.json(users);
    });
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
    const { username, email, password, role, department } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run('INSERT INTO users (username, email, password, role, department) VALUES (?, ?, ?, ?, ?)',
        [username, email, hashedPassword, role, department], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to create user' });
            res.json({ message: 'User created successfully', userId: this.lastID });
        });
});

// Dashboard analytics
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
    const { department, category, team_member } = req.query;
    
    let baseQuery = 'SELECT COUNT(*) as count FROM tickets WHERE 1=1';
    let params = [];

    if (department) {
        baseQuery += ' AND department = ?';
        params.push(department);
    }
    if (category) {
        baseQuery += ' AND ticket_type = ?';
        params.push(category);
    }
    if (team_member) {
        baseQuery += ' AND assigned_to = ?';
        params.push(team_member);
    }

    const queries = {
        total: baseQuery,
        open: baseQuery + ' AND status = "open"',
        inProgress: baseQuery + ' AND status = "in_progress"',
        closed: baseQuery + ' AND status = "closed"',
        overdue: baseQuery + ' AND status != "closed" AND created_at < datetime("now", "-72 hours")'
    };

    const stats = {};
    let completed = 0;

    Object.keys(queries).forEach(key => {
        db.get(queries[key], params, (err, result) => {
            if (!err) stats[key] = result.count;
            completed++;
            if (completed === Object.keys(queries).length) {
                res.json(stats);
            }
        });
    });
});

// Settings management
app.get('/api/settings', authenticateToken, requireAdmin, (req, res) => {
    db.get('SELECT * FROM settings WHERE id = 1', (err, settings) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch settings' });
        res.json(settings || {});
    });
});

app.put('/api/settings', authenticateToken, requireAdmin, (req, res) => {
    const { company_name, ldap_url, ldap_base_dn, email_host, email_port, email_user } = req.body;
    
    db.run(`UPDATE settings SET company_name = ?, ldap_url = ?, ldap_base_dn = ?, 
            email_host = ?, email_port = ?, email_user = ? WHERE id = 1`,
        [company_name, ldap_url, ldap_base_dn, email_host, email_port, email_user], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to update settings' });
            res.json({ message: 'Settings updated successfully' });
        });
});

// Logo upload
app.post('/api/upload-logo', authenticateToken, requireAdmin, upload.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const logoPath = `/uploads/${req.file.filename}`;
    
    db.run('UPDATE settings SET logo_path = ? WHERE id = 1', [logoPath], (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update logo' });
        res.json({ message: 'Logo updated successfully', path: logoPath });
    });
});

// Get overdue tickets
app.get('/api/tickets/overdue', authenticateToken, requireAdmin, (req, res) => {
    db.all(`SELECT * FROM tickets 
            WHERE status != 'closed' 
            AND datetime(created_at, '+' || time_to_resolve || ' hours') < datetime('now')
            ORDER BY created_at`, (err, tickets) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch overdue tickets' });
        res.json(tickets);
    });
});

// Helper functions
async function authenticateLDAP(username, password) {
    return new Promise((resolve, reject) => {
        if (!ldapClient) return reject('LDAP not configured');

        ldapClient.bind(`cn=${username},${process.env.LDAP_BASE_DN}`, password, (err) => {
            if (err) return reject(err);

            ldapClient.search(`cn=${username},${process.env.LDAP_BASE_DN}`, {}, (err, res) => {
                if (err) return reject(err);

                res.on('searchEntry', (entry) => {
                    const user = {
                        username: entry.object.cn,
                        email: entry.object.mail,
                        department: entry.object.department
                    };
                    resolve(user);
                });

                res.on('error', reject);
            });
        });
    });
}

function sendEmailNotification(email, ticketId, ticketData) {
    const mailOptions = {
        from: 'noreply@graviti.com',
        to: email,
        subject: `New IT Ticket #${ticketId} - ${ticketData.ticket_type}`,
        html: `
            <h2>New IT Ticket Created</h2>
            <p><strong>Ticket ID:</strong> ${ticketId}</p>
            <p><strong>Type:</strong> ${ticketData.ticket_type}</p>
            <p><strong>Severity:</strong> ${ticketData.severity}</p>
            <p><strong>Requestor:</strong> ${ticketData.requestor}</p>
            <p><strong>Description:</strong> ${ticketData.description}</p>
            <p><strong>Location:</strong> ${ticketData.location}</p>
            <p><a href="${SERVER_URL}/admin.html">View Ticket Details</a></p>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) console.log('Email error:', error);
        else console.log('Email sent:', info.response);
    });
}

// Serve static files
app.use('/uploads', express.static('uploads'));

// Socket.IO for real-time updates
io.on('connection', (socket) => {
    console.log('User connected');
    
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

// Start server
server.listen(PORT, () => {
    console.log(`Graviti Ticketing System running on port ${PORT}`);
    console.log(`Access the application at: ${SERVER_URL}`);
});
