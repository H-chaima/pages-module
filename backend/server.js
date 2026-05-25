const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3001;

// ==================== SUPABASE AUTH SETUP ====================
// !!! REPLACE WITH YOUR ACTUAL VALUES !!!
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================== POSTGRESQL DATABASE SETUP ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

console.log('📦 Using PostgreSQL (Cloud mode)');

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
    
    try {
        const result = await pool.query(
            'SELECT * FROM pages WHERE status = $1 ORDER BY createdat DESC',
            ['published']
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get user's own pages (drafts + their published)
app.get('/api/pages/all', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const result = await pool.query(
            'SELECT * FROM pages WHERE userid = $1 ORDER BY createdat DESC',
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single page
app.get('/api/pages/:id', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const result = await pool.query(
            'SELECT * FROM pages WHERE id = $1',
            [req.params.id]
        );
        
        const page = result.rows[0];
        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }
        
        if (page.status === 'draft' && page.userid !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        res.json(page);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
        // Update existing page
        try {
            const check = await pool.query(
                'SELECT userid FROM pages WHERE id = $1',
                [id]
            );
            
            if (!check.rows[0] || check.rows[0].userid !== userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            await pool.query(
                'UPDATE pages SET title = $1, content = $2, status = $3, updatedat = $4 WHERE id = $5',
                [title, content, status, now, id]
            );
            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } else {
        // Create new page
        const newId = Date.now().toString();
        try {
            await pool.query(
                'INSERT INTO pages (id, title, content, status, userid, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [newId, title, content, status || 'published', userId, now, now]
            );
            res.json({ success: true, id: newId });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
});

// Search pages
app.get('/api/search/:query', async (req, res) => {
    const userId = await getUserIdFromToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const searchValue = `%${req.params.query}%`;
    try {
        const result = await pool.query(
            'SELECT * FROM pages WHERE status = $1 AND title ILIKE $2 ORDER BY createdat DESC',
            ['published', searchValue]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

// Start server
app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`   Environment: PRODUCTION (PostgreSQL)`);
});
