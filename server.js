require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ==========================
// ENV CHECK
// ==========================
if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_KEY ||
  !process.env.ASHTECH_API_KEY
) {
  throw new Error("Missing environment variables");
}

// ==========================
// SUPABASE
// ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ==========================
// MIDDLEWARE
// ==========================
app.use(cors());
app.use(express.json());

// ==========================
// AUTH MIDDLEWARE
// ==========================
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================
// HEALTH
// ==========================
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// ==========================
// PLANS
// ==========================
app.get('/api/plans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*');

    if (error) throw error;

    const rate = 600;

    const transformed = data.map(plan => ({
      ...plan,
      price: Math.round(plan.price * rate),
      currency: 'FCFA'
    }));

    res.json(transformed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// AUTH
// ==========================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashed }])
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
// PAYMENT ROUTE
// ==========================
app.post('/api/pay', authenticate, async (req, res) => {
  try {
    const { amount, plan, phone, operator } = req.body;
    const userId = req.user.userId;

    if (!amount || !phone || !operator) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const reference = `ORDER-${Date.now()}`;

    // 1. Save transaction
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

    // 2. Call Ashtech API
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

    res.json({
      ...data,
      reference
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// VERIFY PAYMENT (BASIC)
// ==========================
app.get('/api/verify/:reference', authenticate, async (req, res) => {
  try {
    const { reference } = req.params;

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error) throw error;

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// START SERVER
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
    console.error('❌ Supabase failed:', err.message);
    process.exit(1);
  }
})();
