require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { createClient } = require('@supabase/supabase-js');

const app = express();

// ==========================
// ENV CHECK
// ==========================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.JWT_SECRET) {
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
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 Fetch user from DB (never trust token only)
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid user' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================
// PLAN PROTECTION
// ==========================
const requirePlan = (plan) => {
  return (req, res, next) => {
    if (req.user.plan !== plan) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};

// ==========================
// HEALTH
// ==========================
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// ==========================
// AUTH
// ==========================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, plan } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashed, plan: plan || 'Basic Plan' }])
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { userId: data.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// PAYMENT
// ==========================
app.post('/api/pay', authenticate, async (req, res) => {
  try {
    const { amount, plan, phone, operator } = req.body;

    if (!amount || !plan || !phone || !operator) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const reference = `ORDER-${Date.now()}`;

    // Save transaction
    await supabase.from('transactions').insert([{
      user_id: req.user.id,
      plan,
      amount,
      status: 'pending',
      reference
    }]);

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

    res.json({ ...data, reference });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// VERIFY PAYMENT + UPGRADE PLAN
// ==========================
app.post('/api/verify', authenticate, async (req, res) => {
  try {
    const { reference } = req.body;

    const { data: transaction } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', reference)
      .single();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // 🔥 SIMULATION (replace with real API check)
    const paymentSuccess = true;

    if (!paymentSuccess) {
      return res.status(400).json({ error: 'Payment not confirmed' });
    }

    // 🔥 UPDATE USER PLAN
    await supabase
      .from('users')
      .update({ plan: transaction.plan })
      .eq('id', req.user.id);

    // 🔥 UPDATE TRANSACTION
    await supabase
      .from('transactions')
      .update({ status: 'completed' })
      .eq('reference', reference);

    res.json({ message: 'Payment verified, plan upgraded' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// PROTECTED CONTENT EXAMPLE
// ==========================
app.get('/api/premium', authenticate, requirePlan('Premium Plan'), (req, res) => {
  res.json({ message: 'Premium content' });
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
