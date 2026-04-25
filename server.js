require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ==========================
// MIDDLEWARE
// ==========================
app.use(cors());
app.use(express.json());
// 🔥 ADD THIS BLOCK HERE
// ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ==========================
// 🔥 PLAN SYSTEM (PUT IT HERE)
// ==========================
const planHierarchy = {
  basic: 1,
  premium: 2,
  enterprise: 3
};

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
// ==========================
// AUTH MIDDLEWARE (FIXED)
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

    // 🔥 NORMALIZE PLAN HERE (IMPORTANT)
    user.plan = normalizePlan(user.plan);

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
// ==========================
// PLAN PROTECTION (FIXED)
// ==========================
const requirePlan = (requiredPlan) => {
  return (req, res, next) => {
    const userLevel = planHierarchy[req.user.plan];
    const requiredLevel = planHierarchy[requiredPlan];

    if (userLevel < requiredLevel) {
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
// CONSULTATION ROUTE
// ==========================
app.post('/api/consultation', authenticate, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const { data, error } = await supabase
      .from('consultations')
      .insert([
        {
          user_id: req.user.id,
          message
        }
      ]);

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// REGISTER
// ==========================
app.post('/api/auth/register', async (req, res) => {
  try {
    let { email, password, plan } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    plan = normalizePlan(plan);

    // 🔥 CHECK DUPLICATE USER
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashed, plan }])
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { userId: data.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = data;

res.json({
  token,
  user: safeUser
});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================
// LOGIN (UNCHANGED BUT SAFE)
// ==========================
// ==========================
// LOGIN
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

    user.plan = normalizePlan(user.plan);

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

 const { password: _, ...safeUser } = user;

res.json({
  token,
  user: safeUser
});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================
// ==========================
// PROTECTED CONTENT ROUTES
// ==========================

// BASIC (everyone)
app.get('/api/basic', authenticate, requirePlan('basic'), (req, res) => {
  res.json({ message: 'Basic content' });
});

// PREMIUM
app.get('/api/premium', authenticate, requirePlan('premium'), (req, res) => {
  res.json({ message: 'Premium content' });
});

// ENTERPRISE
app.get('/api/enterprise', authenticate, requirePlan('enterprise'), (req, res) => {
  res.json({ message: 'Enterprise content' });
});

// ==========================
// 🔥 GET USER ACCESS DATA
// ==========================
app.get('/api/me', authenticate, (req, res) => {
  res.json({
    email: req.user.email,
    plan: req.user.plan,
    accessLevel: planHierarchy[req.user.plan]
  });
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

    // 🔥 FORCE CORRECT VALUES
    const normalizedPlans = data.map((plan) => {
      let type = 'basic';
      let price = 6000;

      const name = plan.name?.en?.toLowerCase() || '';

      if (name.includes('premium')) {
        type = 'premium';
        price = 13000;
      } else if (name.includes('enterprise')) {
        type = 'enterprise';
        price = 25000;
      }

      return {
        ...plan,
        type,
        price,               // ✅ FORCE CORRECT PRICE
        currency: 'FCFA',    // ✅ FORCE CURRENCY
      };
    });

    res.json(normalizedPlans);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.get('/', (req, res) => {
  res.send('CanadaExpress API is running');
});
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
