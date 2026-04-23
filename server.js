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
// 🔥 PLAN NORMALIZER (CRITICAL)
// ==========================
const normalizePlan = (plan) => {
  if (!plan) return 'basic';

  const p = plan.toLowerCase();

  if (p.includes('basic')) return 'basic';
  if (p.includes('premium')) return 'premium';
  if (p.includes('enterprise')) return 'enterprise';

  return 'basic';
};

// ==========================
// AUTH MIDDLEWARE
// ==========================
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
// PLAN PROTECTION (FIXED)
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
// REGISTER (FIXED)
// ==========================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{
        email,
        password: hashed,
        plan: null // ❌ NO PLAN YET
      }])
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

app.post('/api/payment/confirm', authenticate, async (req, res) => {
  try {
    const { plan } = req.body;

    const normalizedPlan = normalizePlan(plan);

    const { error } = await supabase
      .from('users')
      .update({ plan: normalizedPlan })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ success: true, plan: normalizedPlan });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================
// LOGIN (UNCHANGED BUT SAFE)
// ==========================
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
// PROTECTED ROUTES (FIXED)
// ==========================
app.get('/api/basic', authenticate, requirePlan('basic'), (req, res) => {
  res.json({ message: 'Basic content' });
});

app.get('/api/premium', authenticate, requirePlan('premium'), (req, res) => {
  res.json({ message: 'Premium content' });
});

app.get('/api/enterprise', authenticate, requirePlan('enterprise'), (req, res) => {
  res.json({ message: 'Enterprise content' });
});

// ==========================
// GET PLANS
// ==========================
app.get('/api/plans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*');

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

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
