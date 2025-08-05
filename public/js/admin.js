const socket = io();
let allTickets = [];
let allUsers = [];

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    if (!token || user.role !== 'admin') {
        window.location.href = '/login.html';
        return;
    }
    
    loadAllTickets();
    loadUsers();
    loadSettings();
    updateDashboard();
    
    // Setup form submissions
    setupFormHandlers();
    
    // Socket event listeners
    socket.on('newTicket', () => {
        loadAllTickets();
        updateDashboard();
    });
    
    socket.on('ticketUpdated', () => {
        loadAllTickets();
        updateDashboard();
    });
});

// Setup form handlers
function setupFormHandlers() {
    document.getElementById('addUserForm').addEventListener('submit', addUser);
    document.getElementById('ldapForm').addEventListener('submit', saveLdapSettings);
    document.getElementById('emailForm').addEventListener('submit', saveEmailSettings);
}

// Show section
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionId).classList.add('active');
    
    // Add active class to clicked nav button
    event.target.classList.add('active');
    
    // Load section-specific data
    switch(sectionId) {
        case 'tickets':
            loadAllTickets();
            break;
        case 'kanban':
            loadKanbanBoard();
            break;
        case 'ticket-flow':
            loadTicketFlow();
            break;
        case 'users':
            loadUsers();
            break;
        case 'dashboard':
            updateDashboard();
            break;
    }
}

// Load all tickets
async function loadAllTickets() {
    try {
        const response = await fetch('/api/tickets', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        allTickets = await response.json();
        displayAdminTickets(allTickets);
    } catch (error) {
        document.getElementById('adminTicketsList').innerHTML = 
            '<div class="error-message">Failed to load tickets</div>';
    }
}

// Display admin tickets
function displayAdminTickets(tickets) {
    const container = document.getElementById('adminTicketsList');
    
    if (tickets.length === 0) {
        container.innerHTML = '<div class="loading">No tickets found</div>';
        return;
    }
    
    container.innerHTML = tickets.map(ticket => `
        <div class="ticket-card admin-ticket-card" onclick="showTicketActions(${ticket.id})">
            <div class="ticket-header">
                <span class="ticket-id">#${ticket.id}</span>
                <span class="ticket-status status-${ticket.status}">${ticket.status.replace('_', ' ')}</span>
                <span class="severity-badge severity-${ticket.severity.toLowerCase()}">${ticket.severity}</span>
            </div>
            <div class="ticket-content">
                <h3>${ticket.ticket_type}</h3>
                <p><strong>Requestor:</strong> ${ticket.requestor}</p>
                <p>${ticket.description.substring(0, 150)}...</p>
                <div class="ticket-meta">
                    <span>Created: ${new Date(ticket.created_at).toLocaleDateString()}</span>
                    <span>Updated: ${new Date(ticket.updated_at).toLocaleDateString()}</span>
                    ${ticket.assigned_to ? `<span>Assigned: ${ticket.assigned_to}</span>` : '<span>Unassigned</span>'}
                </div>
            </div>
            <div class="ticket-actions">
                <button onclick="assignTicket(${ticket.id}); event.stopPropagation();" class="btn btn-primary">Assign</button>
                <button onclick="changeSeverity(${ticket.id}); event.stopPropagation();" class="btn btn-secondary">Change Severity</button>
                <button onclick="updateStatus(${ticket.id}); event.stopPropagation();" class="btn btn-secondary">Update Status</button>
            </div>
        </div>
    `).join('');
}

// Show ticket actions modal
function showTicketActions(ticketId) {
    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;
    
    const modal = document.getElementById('ticketActionsModal');
    const body = document.getElementById('ticketActionsBody');
    
    body.innerHTML = `
        <div class="ticket-actions-content">
            <h4>Ticket #${ticket.id} - ${ticket.ticket_type}</h4>
            
            <div class="action-section">
                <h5>Assign Ticket</h5>
                <select id="assignUser" onchange="assignTicketToUser(${ticketId}, this.value)">
                    <option value="">Select user to assign</option>
                    ${allUsers.map(user => `
                        <option value="${user.username}" ${ticket.assigned_to === user.username ? 'selected' : ''}>
                            ${user.username} (${user.department})
                        </option>
                    `).join('')}
                </select>
            </div>
            
            <div class="action-section">
                <h5>Change Severity</h5>
                <select id="severitySelect" onchange="updateTicketSeverity(${ticketId}, this.value)">
                    <option value="High" ${ticket.severity === 'High' ? 'selected' : ''}>High</option>
                    <option value="Medium" ${ticket.severity === 'Medium' ? 'selected' : ''}>Medium</option>
                    <option value="Low" ${ticket.severity === 'Low' ? 'selected' : ''}>Low</option>
                </select>
            </div>
            
            <div class="action-section">
                <h5>Update Status</h5>
                <select id="statusSelect" onchange="updateTicketStatus(${ticketId}, this.value)">
                    <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                    <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
            </div>
            
            <div class="ticket-details">
                <h5>Ticket Details</h5>
                <p><strong>Description:</strong> ${ticket.description}</p>
                <p><strong>Location:</strong> ${ticket.location || 'Not specified'}</p>
                <p><strong>Employee ID:</strong> ${ticket.employee_id || 'Not specified'}</p>
                <p><strong>Requestor:</strong> ${ticket.requestor}</p>
                <p><strong>Created:</strong> ${new Date(ticket.created_at).toLocaleString()}</p>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

// Assign ticket to user
async function assignTicketToUser(ticketId, username) {
    if (!username) return;
    
    try {
        const response = await fetch(`/api/tickets/${ticketId}/assign`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ assigned_to: username })
        });
        
        if (response.ok) {
            alert('Ticket assigned successfully');
            loadAllTickets();
            closeModal();
        } else {
            alert('Error assigning ticket');
        }
    } catch (error) {
        alert('Error assigning ticket');
    }
}

// Update ticket severity
async function updateTicketSeverity(ticketId, severity) {
    try {
        const response = await fetch(`/api/tickets/${ticketId}/severity`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ severity })
        });
        
        if (response.ok) {
            alert('Severity updated successfully');
            loadAllTickets();
        } else {
            alert('Error updating severity');
        }
    } catch (error) {
        alert('Error updating severity');
    }
}

// Update ticket status
async function updateTicketStatus(ticketId, status) {
    try {
        const response = await fetch(`/api/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            alert('Status updated successfully');
            loadAllTickets();
        } else {
            alert('Error updating status');
        }
    } catch (error) {
        alert('Error updating status');
    }
}

// Load Kanban board
function loadKanbanBoard() {
    const openColumn = document.getElementById('openColumn');
    const inProgressColumn = document.getElementById('inProgressColumn');
    const closedColumn = document.getElementById('closedColumn');
    
    openColumn.innerHTML = '';
    inProgressColumn.innerHTML = '';
    closedColumn.innerHTML = '';
    
    allTickets.forEach(ticket => {
        const card = createKanbanCard(ticket);
        
        switch(ticket.status) {
            case 'open':
                openColumn.appendChild(card);
                break;
            case 'in_progress':
                inProgressColumn.appendChild(card);
                break;
            case 'closed':
                closedColumn.appendChild(card);
                break;
        }
    });
}

// Create Kanban card
function createKanbanCard(ticket) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.draggable = true;
    card.dataset.ticketId = ticket.id;
    
    card.innerHTML = `
        <div class="kanban-card-header">
            <span class="ticket-id">#${ticket.id}</span>
            <span class="severity-badge severity-${ticket.severity.toLowerCase()}">${ticket.severity}</span>
        </div>
        <h4>${ticket.ticket_type}</h4>
        <p><strong>Requestor:</strong> ${ticket.requestor}</p>
        <p>${ticket.description.substring(0, 60)}...</p>
        ${ticket.assigned_to ? `<p><strong>Assigned:</strong> ${ticket.assigned_to}</p>` : ''}
    `;
    
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', ticket.id);
        card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });
    
    return card;
}

// Allow drop
function allowDrop(ev) {
    ev.preventDefault();
}

// Drop function
function drop(ev) {
    ev.preventDefault();
    const ticketId = ev.dataTransfer.getData('text/plain');
    const dropZone = ev.target.closest('.kanban-items');
    
    if (!dropZone) return;
    
    let newStatus;
    switch(dropZone.id) {
        case 'openColumn':
            newStatus = 'open';
            break;
        case 'inProgressColumn':
            newStatus = 'in_progress';
            break;
        case 'closedColumn':
            newStatus = 'closed';
            break;
        default:
            return;
    }
    
    updateTicketStatus(ticketId, newStatus);
}

// Load ticket flow
function loadTicketFlow() {
    const tbody = document.getElementById('ticketFlowBody');
    
    tbody.innerHTML = allTickets.map(ticket => `
        <tr>
            <td>#${ticket.id}</td>
            <td>${ticket.ticket_type}</td>
            <td><span class="ticket-status status-${ticket.status}">${ticket.status.replace('_', ' ')}</span></td>
            <td>${new Date(ticket.updated_at).toLocaleDateString()}</td>
            <td>${new Date(ticket.created_at).toLocaleDateString()}</td>
            <td><span class="severity-badge severity-${ticket.severity.toLowerCase()}">${ticket.severity}</span></td>
            <td>${ticket.requestor}</td>
            <td>${ticket.assigned_to || 'Unassigned'}</td>
            <td>${ticket.ticket_type}</td>
            <td>${ticket.time_to_resolve || 72} hours</td>
        </tr>
    `).join('');
}

// Load users
async function loadUsers() {
    try {
        const response = await fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        allUsers = await response.json();
        displayUsers(allUsers);
        populateUserSelects();
    } catch (error) {
        document.getElementById('usersList').innerHTML = 
            '<div class="error-message">Failed to load users</div>';
    }
}

// Display users
function displayUsers(users) {
    const container = document.getElementById('usersList');
    
    container.innerHTML = users.map(user => `
        <div class="user-card">
            <div class="user-info">
                <h3>${user.username}</h3>
                <p>Email: ${user.email}</p>
                <p>Role: ${user.role}</p>
                <p>Department: ${user.department}</p>
                <p>Created: ${new Date(user.created_at).toLocaleDateString()}</p>
            </div>
        </div>
    `).join('');
}

// Populate user selects
function populateUserSelects() {
    const teamMemberSelect = document.getElementById('dashTeamMember');
    if (teamMemberSelect) {
        teamMemberSelect.innerHTML = '<option value="">All Team Members</option>' +
            allUsers.map(user => `<option value="${user.username}">${user.username}</option>`).join('');
    }
}

// Show add user modal
function showAddUserModal() {
    document.getElementById('addUserModal').classList.remove('hidden');
}

// Add user
async function addUser(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const userData = {
        username: formData.get('username'),
        email: formData.get('email'),
        password: formData.get('password'),
        role: formData.get('role'),
        department: formData.get('department')
    };
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            alert('User added successfully');
            e.target.reset();
            closeModal();
            loadUsers();
        } else {
            const error = await response.json();
            alert('Error adding user: ' + error.error);
        }
    } catch (error) {
        alert('Error adding user');
    }
}

// Update dashboard
async function updateDashboard() {
    const department = document.getElementById('dashDepartment')?.value || '';
    const category = document.getElementById('dashCategory')?.value || '';
    const teamMember = document.getElementById('dashTeamMember')?.value || '';
    
    const params = new URLSearchParams();
    if (department) params.append('department', department);
    if (category) params.append('category', category);
    if (teamMember) params.append('team_member', teamMember);
    
    try {
        const response = await fetch(`/api/dashboard/stats?${params}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const stats = await response.json();
        
        document.getElementById('dashTotal
