const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();

// 🔥 Supabase client (replaces Sequelize + db.js)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error("❌ Missing Supabase environment variables");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
// Middleware
const CLIENT_URL =
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  'http://localhost:3000';

const corsOptions = {
  origin: CLIENT_URL,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// 🔥 Supabase connection test (replaces sequelize.authenticate)
(async () => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('id')
      .limit(1);

    if (error) throw error;

    console.log('✓ Supabase connected and plans table accessible');
  } catch (err) {
    console.error('❌ Supabase error:', err.message);
  }
})();

// 🔥 OPTIONAL: seed logic (only if you rewrite it for Supabase)
if (process.env.SEED_DB === 'true') {
  console.log('⚠️ Seed requested — make sure it uses Supabase, not Sequelize');
  // You must rewrite seedPlans / seedContent using supabase
}

// Routes (⚠️ your routes MUST use supabase now)
app.use('/api/plans', require('./routes/plans'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/payment', require('./routes/payment'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
