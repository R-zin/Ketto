import { Store } from './server/dist/db.js';

const db = new Store('./data/kettoo.sqlite');

setInterval(() => {
  try {
    const unapproved = db.all('SELECT id, user_id, name FROM devices WHERE approved=0');
    if (unapproved.length > 0) {
      for (const d of unapproved) {
        db.run('UPDATE devices SET approved=1 WHERE id=?', d.id);
        console.log(`Auto-approved device: ${d.name} (${d.id})`);
      }
    }
  } catch (err) {
    console.error('Auto approve error:', err.message);
  }
}, 1000);

console.log('Device auto-approver running.');
