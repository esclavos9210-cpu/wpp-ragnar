const Database = require('better-sqlite3');
const db = new Database('data/messages.db');
const state = db.prepare('SELECT status, phone, length(qr_data) as qr_len FROM connection_state').get();
console.log('State:', state);
