const socket = io();
let currentUser = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = user;
    document.getElementById('userName').textContent = user.username || 'User';
    
    loadMyTickets();
    loadDashboardStats();
    
    // Setup form submission
    document.getElementById('ticketForm').addEventListener('submit', createTicket);
    
    // Socket event listeners
    socket.on('newTicket', (ticket) => {
        if (ticket.requestor === currentUser.username) {
            loadMyTickets();
            loadDashboardStats();
        }
    });
    
    socket.on('ticketUpdated', () => {
        loadMyTickets();
        loadDashboardStats();
    });
});

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
    if (sectionId === 'my-tickets') {
        loadMyTickets();
    } else if (sectionId === 'dashboard-stats') {
        loadDashboardStats();
    }
}

// Create ticket
async function createTicket(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const loadingSpan = document.querySelector('#ticketForm .loading');
    const textSpan = document.querySelector('#ticketForm .text');
    
    loadingSpan.classList.remove('hidden');
    textSpan.classList.add('hidden');
    
    try {
        const response = await fetch('/api/tickets', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`Ticket created successfully! Ticket ID: ${data.ticketId}`);
            e.target.reset();
            loadMyTickets();
            loadDashboardStats();
        } else {
            alert('Error creating ticket: ' + data.error);
        }
    } catch (error) {
        alert('Error creating ticket');
    } finally {
        loadingSpan.classList.add('hidden');
        textSpan.classList.remove('hidden');
    }
}

// Load my tickets
async function loadMyTickets() {
    try {
        const response = await fetch('/api/tickets', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const tickets = await response.json();
        displayTickets(tickets);
    } catch (error) {
        document.getElementById('ticketsList').innerHTML = 
            '<div class="error-message">Failed to load tickets</div>';
    }
}

// Display tickets
function displayTickets(tickets) {
    const container = document.getElementById('ticketsList');
    
    if (tickets.length === 0) {
        container.innerHTML = '<div class="loading">No tickets found</div>';
        return;
    }
    
    container.innerHTML = tickets.map(ticket => `
        <div class="ticket-card" onclick="viewTicket(${ticket.id})">
            <div class="ticket-header">
                <span class="ticket-id">#${ticket.id}</span>
                <span class="ticket-status status-${ticket.status}">${ticket.status.replace('_', ' ')}</span>
            </div>
            <div class="ticket-content">
                <h3>${ticket.ticket_type}</h3>
                <p>${ticket.description.substring(0, 100)}...</p>
                <div class="ticket-meta">
                    <span>Severity: ${ticket.severity}</span>
                    <span>Created: ${new Date(ticket.created_at).toLocaleDateString()}</span>
                    ${ticket.assigned_to ? `<span>Assigned to: ${ticket.assigned_to}</span>` : ''}
                </div>
            </div>
            ${ticket.status === 'closed' ? 
                `<button onclick="reopenTicket(${ticket.id}); event.stopPropagation();" class="btn btn-secondary">Reopen</button>` : ''
            }
        </div>
    `).join('');
}

// View ticket details
async function viewTicket(ticketId) {
    try {
        const response = await fetch(`/api/tickets/${ticketId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const ticket = await response.json();
        
        if (response.ok) {
            showTicketModal(ticket);
        } else {
            alert('Error loading ticket details');
        }
    } catch (error) {
        alert('Error loading ticket details');
    }
}

// Show ticket modal
function showTicketModal(ticket) {
    const modal = document.getElementById('ticketModal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    
    title.textContent = `Ticket #${ticket.id} - ${ticket.ticket_type}`;
    
    body.innerHTML = `
        <div class="ticket-details">
            <div class="detail-row">
                <label>Status:</label>
                <span class="ticket-status status-${ticket.status}">${ticket.status.replace('_', ' ')}</span>
            </div>
            <div class="detail-row">
                <label>Severity:</label>
                <span>${ticket.severity}</span>
            </div>
            <div class="detail-row">
                <label>Created:</label>
                <span>${new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
            <div class="detail-row">
                <label>Last Updated:</label>
                <span>${new Date(ticket.updated_at).toLocaleDateString()}</span>
            </div>
            ${ticket.assigned_to ? `
                <div class="detail-row">
                    <label>Assigned to:</label>
                    <span>${ticket.assigned_to}</span>
                </div>
            ` : ''}
            <div class="detail-row">
                <label>Location:</label>
                <span>${ticket.location || 'Not specified'}</span>
            </div>
            <div class="detail-row">
                <label>Employee ID:</label>
                <span>${ticket.employee_id || 'Not specified'}</span>
            </div>
            <div class="detail-row">
                <label>Description:</label>
                <p>${ticket.description}</p>
            </div>
            ${ticket.attachments ? `
                <div class="detail-row">
                    <label>Attachments:</label>
                    <span>${ticket.attachments}</span>
                </div>
            ` : ''}
            
            <div class="comments-section">
                <h4>Comments</h4>
                <div class="comments-list">
                    ${ticket.comments ? ticket.comments.map(comment => `
                        <div class="comment">
                            <div class="comment-header">
                                <strong>${comment.username}</strong>
                                <span>${new Date(comment.created_at).toLocaleDateString()}</span>
                            </div>
                            <p>${comment.comment}</p>
                        </div>
                    `).join('') : '<p>No comments yet</p>'}
                </div>
                
                <form onsubmit="addComment(event, ${ticket.id})" class="comment-form">
                    <textarea name="comment" placeholder="Add a comment..." required></textarea>
                    <button type="submit" class="btn btn-primary">Add Comment</button>
                </form>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

// Add comment
async function addComment(e, ticketId) {
    e.preventDefault();
    
    const comment = e.target.comment.value;
    
    try {
        const response = await fetch(`/api/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ comment })
        });
        
        if (response.ok) {
            e.target.reset();
            viewTicket(ticketId); // Refresh ticket details
        } else {
            alert('Error adding comment');
        }
    } catch (error) {
        alert('Error adding comment');
    }
}

// Reopen ticket
async function reopenTicket(ticketId) {
    if (!confirm('Are you sure you want to reopen this ticket?')) return;
    
    try {
        const response = await fetch(`/api/tickets/${ticketId}/reopen`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            alert('Ticket reopened successfully');
            loadMyTickets();
        } else {
            alert('Error reopening ticket');
        }
    } catch (error) {
        alert('Error reopening ticket');
    }
}

// Load dashboard stats
async function loadDashboardStats() {
    try {
        const response = await fetch('/api/dashboard/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const stats = await response.json();
        
        document.getElementById('totalTickets').textContent = stats.total || 0;
        document.getElementById('openTickets').textContent = stats.open || 0;
        document.getElementById('inProgressTickets').textContent = stats.inProgress || 0;
        document.getElementById('closedTickets').textContent = stats.closed || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Filter tickets
function filterTickets() {
    const status = document.getElementById('statusFilter').value;
    const url = status ? `/api/tickets?status=${status}` : '/api/tickets';
    
    fetch(url, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(response => response.json())
    .then(tickets => displayTickets(tickets))
    .catch(error => console.error('Error filtering tickets:', error));
}

// Close modal
function closeModal() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
    });
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal();
    }
});
