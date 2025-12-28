/**
 * VISIONBOARD Backend Server
 * Simple REST API with SQLite database
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Authentication - Password from environment variable
const AUTH_PASSWORD = process.env.VISIONBOARD_PASSWORD || 'visionboard2025';
const sessions = new Map(); // Simple in-memory session store

// Generate session token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Auth middleware
function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized', needsAuth: true });
    }
    // Refresh session expiry
    sessions.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24h
    next();
}

// Clean expired sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of sessions) {
        if (expiry < now) sessions.delete(token);
    }
}, 60 * 60 * 1000);

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'visionboard.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT DEFAULT 'Mein Board',
        viewport_x REAL DEFAULT 0,
        viewport_y REAL DEFAULT 0,
        zoom REAL DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        board_id TEXT DEFAULT 'default',
        type TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL,
        height REAL,
        content TEXT,
        style TEXT,
        z_index INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (board_id) REFERENCES boards(id)
    );
    
    CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        board_id TEXT DEFAULT 'default',
        text TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        priority TEXT DEFAULT 'medium',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (board_id) REFERENCES boards(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_items_board ON items(board_id);
    CREATE INDEX IF NOT EXISTS idx_todos_board ON todos(board_id);
`);

// Create default board if not exists
const defaultBoard = db.prepare('SELECT id FROM boards WHERE id = ?').get('default');
if (!defaultBoard) {
    db.prepare('INSERT INTO boards (id, name) VALUES (?, ?)').run('default', 'Mein Visionboard');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../')));

// ========================================
// Auth Routes (no auth required)
// ========================================

// Login endpoint
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (password === AUTH_PASSWORD) {
        const token = generateToken();
        sessions.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24h expiry
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Falsches Passwort' });
    }
});

// Check auth status
app.get('/api/auth/check', (req, res) => {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (token && sessions.has(token)) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) sessions.delete(token);
    res.json({ success: true });
});

// ========================================
// Board Routes (auth required)
// ========================================

// Get board data (items + todos + viewport)
app.get('/api/board/:id', requireAuth, (req, res) => {
    try {
        const boardId = req.params.id;
        
        let board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
        if (!board) {
            // Create board if not exists
            db.prepare('INSERT INTO boards (id, name) VALUES (?, ?)').run(boardId, 'Neues Board');
            board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
        }
        
        const items = db.prepare('SELECT * FROM items WHERE board_id = ? ORDER BY z_index').all(boardId);
        const todos = db.prepare('SELECT * FROM todos WHERE board_id = ? ORDER BY created_at DESC').all(boardId);
        
        // Parse style JSON for items
        const parsedItems = items.map(item => ({
            ...item,
            style: item.style ? JSON.parse(item.style) : {}
        }));
        
        res.json({
            board: {
                id: board.id,
                name: board.name,
                viewport: { x: board.viewport_x, y: board.viewport_y },
                zoom: board.zoom
            },
            items: parsedItems,
            todos: todos.map(t => ({ ...t, completed: !!t.completed }))
        });
    } catch (error) {
        console.error('Error fetching board:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update board viewport
app.put('/api/board/:id/viewport', requireAuth, (req, res) => {
    try {
        const { x, y, zoom } = req.body;
        const stmt = db.prepare(`
            UPDATE boards SET viewport_x = ?, viewport_y = ?, zoom = ?, updated_at = ? WHERE id = ?
        `);
        stmt.run(x, y, zoom, Date.now(), req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// Item Routes (auth required)
// ========================================

// Create item
app.post('/api/items', requireAuth, (req, res) => {
    try {
        const { id, board_id = 'default', type, x, y, width, height, content, style, z_index = 0 } = req.body;
        const stmt = db.prepare(`
            INSERT INTO items (id, board_id, type, x, y, width, height, content, style, z_index, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        stmt.run(id, board_id, type, x, y, width, height, content, JSON.stringify(style || {}), z_index, now, now);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update item
app.put('/api/items/:id', requireAuth, (req, res) => {
    try {
        const { x, y, width, height, content, style, z_index } = req.body;
        const updates = [];
        const values = [];
        
        if (x !== undefined) { updates.push('x = ?'); values.push(x); }
        if (y !== undefined) { updates.push('y = ?'); values.push(y); }
        if (width !== undefined) { updates.push('width = ?'); values.push(width); }
        if (height !== undefined) { updates.push('height = ?'); values.push(height); }
        if (content !== undefined) { updates.push('content = ?'); values.push(content); }
        if (style !== undefined) { updates.push('style = ?'); values.push(JSON.stringify(style)); }
        if (z_index !== undefined) { updates.push('z_index = ?'); values.push(z_index); }
        
        updates.push('updated_at = ?');
        values.push(Date.now());
        values.push(req.params.id);
        
        const stmt = db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`);
        stmt.run(...values);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete item
app.delete('/api/items/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// Todo Routes (auth required)
// ========================================

// Create todo
app.post('/api/todos', requireAuth, (req, res) => {
    try {
        const { id, board_id = 'default', text, priority = 'medium' } = req.body;
        const stmt = db.prepare(`
            INSERT INTO todos (id, board_id, text, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        stmt.run(id, board_id, text, priority, now, now);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update todo
app.put('/api/todos/:id', requireAuth, (req, res) => {
    try {
        const { text, completed, priority } = req.body;
        const updates = [];
        const values = [];
        
        if (text !== undefined) { updates.push('text = ?'); values.push(text); }
        if (completed !== undefined) { updates.push('completed = ?'); values.push(completed ? 1 : 0); }
        if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
        
        updates.push('updated_at = ?');
        values.push(Date.now());
        values.push(req.params.id);
        
        const stmt = db.prepare(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`);
        stmt.run(...values);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete todo
app.delete('/api/todos/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// Sync Route (auth required)
// ========================================

app.post('/api/sync', requireAuth, (req, res) => {
    try {
        const { board_id = 'default', items, todos, viewport } = req.body;
        
        const transaction = db.transaction(() => {
            // Update viewport
            if (viewport) {
                db.prepare(`
                    UPDATE boards SET viewport_x = ?, viewport_y = ?, zoom = ?, updated_at = ? WHERE id = ?
                `).run(viewport.x, viewport.y, viewport.zoom, Date.now(), board_id);
            }
            
            // Sync items - delete all and re-insert
            db.prepare('DELETE FROM items WHERE board_id = ?').run(board_id);
            const insertItem = db.prepare(`
                INSERT INTO items (id, board_id, type, x, y, width, height, content, style, z_index, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const item of items || []) {
                insertItem.run(
                    item.id, board_id, item.type, item.x, item.y,
                    item.width, item.height, item.content,
                    JSON.stringify(item.style || {}), item.z_index || 0,
                    item.created_at || Date.now(), Date.now()
                );
            }
            
            // Sync todos
            db.prepare('DELETE FROM todos WHERE board_id = ?').run(board_id);
            const insertTodo = db.prepare(`
                INSERT INTO todos (id, board_id, text, completed, priority, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const todo of todos || []) {
                insertTodo.run(
                    todo.id, board_id, todo.text, todo.completed ? 1 : 0,
                    todo.priority || 'medium', todo.created_at || Date.now(), Date.now()
                );
            }
        });
        
        transaction();
        res.json({ success: true, synced_at: Date.now() });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Visionboard Backend running on port ${PORT}`);
    console.log(`📁 Database: ${dbPath}`);
});
