import { Store } from './server/dist/db.js';
const store = new Store('./data/kettoo.sqlite');
console.log('Users in DB:');
console.log(store.all('SELECT id, name, email, role, approved FROM users'));
console.log('Devices in DB:');
console.log(store.all('SELECT id, user_id, name, approved FROM devices'));
store.close();
