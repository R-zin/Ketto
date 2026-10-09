import { Store, id } from './server/dist/db.js';
import { passwordHash } from './server/dist/security.js';

const db = new Store('./data/kettoo.sqlite');

function ensureUser(email, name, password) {
  let user = db.get('SELECT * FROM users WHERE email=?', email.toLowerCase());
  if (!user) {
    const uid = id();
    db.run(
      'INSERT INTO users VALUES(?,?,?,?,?,?)',
      uid,
      name,
      email.toLowerCase(),
      passwordHash(password),
      'staff',
      1
    );
    db.run('INSERT OR IGNORE INTO members VALUES(?,?)', 'all-staff', uid);
    user = db.get('SELECT * FROM users WHERE id=?', uid);
    console.log(`Created user: ${email} (id: ${uid})`);
  } else {
    db.run('UPDATE users SET password=?, approved=1 WHERE id=?', passwordHash(password), user.id);
    db.run('INSERT OR IGNORE INTO members VALUES(?,?)', 'all-staff', user.id);
    console.log(`Updated user: ${email} (id: ${user.id})`);
  }
  // Approve all devices for this user
  db.run('UPDATE devices SET approved=1 WHERE user_id=?', user.id);
  return user;
}

ensureUser('test1@gmail.com', 'Volunteer One', 'test123');
ensureUser('test2@gmail.com', 'Volunteer Two', 'test123');

console.log('Users in database:');
console.log(db.all('SELECT id, name, email, approved FROM users'));
