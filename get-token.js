// get-token.js
const { createClient } = require('@supabase/supabase-js');

// Replace with your values
const supabaseUrl = 'https://jwyddxxaoykxbgeooetp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3eWRkeHhhb3lreGJnZW9vZXRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzOTQwOTYsImV4cCI6MjA4Mzk3MDA5Nn0.n9OU19ps_xh1RVJ2H70_D8k8_4CDLnxprF_W4nbVZYA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function getToken() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin@test.com',
    password: 'admin123.'
  });

  if (error) {
    console.error('Login failed:', error.message);
    return;
  }

  console.log('=== Copy this token ===');
  console.log(data.session.access_token);
  console.log('=======================');
  console.log('\nUser ID:', data.user.id);
  console.log('Expires at:', new Date(data.session.expires_at * 1000).toISOString());
}

getToken();