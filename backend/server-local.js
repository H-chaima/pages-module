const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = 3001;

// ==================== SUPABASE AUTH SETUP ====================
// !!! REPLACE WITH YOUR ACTUAL VALUES !!!
const SUPABASE_URL = 'https://spelqqgukikckqgpbnka.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwZWxxcWd1a2lrY2txZ3BibmthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNzQwNTIsImV4cCI6MjA5NDc1MDA1Mn0.e-M9q2P_k2XI-ggX_7rFgidI2OCbUvnagFIu83F4XSc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================== SQLITE DATABASE ====================
const db = new sqlite3.Database(path.join(__dirname, '..', 'pages.db'));
console.log('📦 Using SQLite (Local mode)');

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Helper to get user ID from token
async function getUserIdFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) return null;
    return user.id;
}

// ==================== API ROUTES ====================

// Get ALL published pages (shared across all users)
app.get('/api/pages', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.all('SELECT * FROM pages WHERE status = "published" ORDER BY createdAt DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Get user's own pages (drafts + their published)
app.get('/api/pages/all', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.all('SELECT * FROM pages WHERE userId = ? ORDER BY createdAt DESC', [userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Get single page
app.get('/api/pages/:id', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT * FROM pages WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!row) {
            res.status(404).json({ error: 'Page not found' });
        } else if (row.status === 'draft' && row.userId !== userId) {
            res.status(403).json({ error: 'Forbidden' });
        } else {
            res.json(row);
        }
    });
});

// Create or update page
app.post('/api/pages', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { id, title, content, status } = req.body;
    const now = new Date().toISOString();
    
    if (id) {
        db.get('SELECT userId FROM pages WHERE id = ?', [id], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else if (!row || row.userId !== userId) {
                res.status(403).json({ error: 'Forbidden' });
            } else {
                db.run(
                    'UPDATE pages SET title = ?, content = ?, status = ?, updatedAt = ? WHERE id = ?',
                    [title, content, status, now, id],
                    function(err) {
                        if (err) {
                            res.status(500).json({ error: err.message });
                        } else {
                            res.json({ success: true, id });
                        }
                    }
                );
            }
        });
    } else {
        const newId = Date.now().toString();
        db.run(
            'INSERT INTO pages (id, title, content, status, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newId, title, content, status || 'published', userId, now, now],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                } else {
                    res.json({ success: true, id: newId });
                }
            }
        );
    }
});

// Search pages
app.get('/api/search/:query', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const query = `%${req.params.query}%`;
    db.all(
        'SELECT * FROM pages WHERE status = "published" AND title LIKE ? ORDER BY createdAt DESC',
        [query],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json(rows);
            }
        }
    );
});

// ==================== AUTH ENDPOINTS ====================
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    
    if (error) {
        res.status(400).json({ error: error.message });
    } else {
        res.json({ user: data.user });
    }
});

app.post('/api/auth/signin', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        res.status(400).json({ error: error.message });
    } else {
        res.json({ token: data.session.access_token, user: data.user });
    }
});

app.post('/api/auth/signout', async (req, res) => {
    const { error } = await supabase.auth.signOut();
    if (error) {
        res.status(400).json({ error: error.message });
    } else {
        res.json({ success: true });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`   Environment: LOCAL (SQLite)`);
});
