async function run() {
  const loginRes = await fetch('http://127.0.0.1:8787/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      email: 'admin@kettoo.local', 
      password: 'kettoo-admin-password-2026',
      deviceId: '06f3781b-e7da-4723-b607-98174a0c42da'
    })
  });
  const admin = await loginRes.json();
  console.log('Admin login result:', admin.user);
  const headers = { Authorization: 'Bearer ' + admin.token };
  const res = await fetch('http://127.0.0.1:8787/api/admin/overview', { headers });
  const overview = await res.json();
  console.log('Users in overview:');
  for (const u of overview.users) {
    console.log(`- ${u.name} (${u.email}) [approved: ${u.approved}]`);
    for (const d of u.devices) {
      console.log(`    Device: ${d.name} [id: ${d.id}, approved: ${d.approved}]`);
    }
  }
}
run();
