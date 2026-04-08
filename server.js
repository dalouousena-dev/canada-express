require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// 🔥 HARD FAIL if env missing
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

// 🔥 Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());

// ==========================
// HEALTH CHECK
// ==========================
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// ==========================
// PLANS ROUTES
// ==========================
app.get('/api/plans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*');

    if (error) throw error;

    // 🔥 Convert USD → FCFA here
    const rate = 600;

    const transformedPlans = data.map(plan => ({
      ...plan,
      price: Math.round(plan.price * rate),
      currency: 'FCFA'
    }));

    res.json(transformedPlans);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// CONTENT ROUTES
// ==========================
app.get('/api/content', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contents')
      .select('*')
      .order('order', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// AUTH ROUTES
// ==========================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashedPassword }])
      .select();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error) throw error;

    const valid = await bcrypt.compare(password, data.password);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: data.id },
      process.env.JWT_SECRET || "secret",
      { expiresIn: '7d' }
    );

    res.json({ token });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// SERVER START (SAFE)
// ==========================
const PORT = process.env.PORT || 5000;

(async () => {
  try {
    const { error } = await supabase
      .from('plans')
      .select('id')
      .limit(1);

    if (error) throw error;

    console.log('✓ Supabase connected');

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Supabase connection failed:', err.message);
    process.exit(1);
  }
})();
app.post('/api/pay', async (req, res) => {
  try {
    const { amount, plan, phone, operator, userId } = req.body;

    if (!amount || !phone || !operator || !userId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const reference = `ORDER-${Date.now()}`;

    // 🔥 1. Save transaction FIRST (critical)
    const { error: insertError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        plan,
        amount,
        status: 'pending',
        reference
      }]);

    if (insertError) throw insertError;

    // 🔥 2. Call Ashtech API
    const fetch = (...args) =>
      import('node-fetch').then(({ default: fetch }) => fetch(...args));

    const response = await fetch('https://api.ashtechpay.top/v1/collect', {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.ASHTECH_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency: "XAF",
        phone,
        operator,
        reference
      })
    });

    const data = await response.json();

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
