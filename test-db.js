const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.jwyddxxaoykxbgeooetp:Paroblin86.pa@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
});

async function test() {
  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully!');

    const result = await client.query('SELECT current_database(), current_user');
    console.log('Database:', result.rows[0].current_database);
    console.log('User:', result.rows[0].current_user);

    const userCheck = await client.query(
      'SELECT user_id, org_id, role FROM public.user_profiles WHERE user_id = $1',
      ['d1b08187-9ace-4f81-8713-a7d65961073f']
    );
    console.log('User profile:', userCheck.rows);

    client.release();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

test();
