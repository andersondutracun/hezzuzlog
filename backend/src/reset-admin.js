import { config, validateConfig } from './config.js';
import { pool, waitForDatabase, migrate } from './db.js';
import { hashPassword } from './security.js';

validateConfig();
await waitForDatabase();
await migrate();
const { salt, hash } = hashPassword(config.adminPassword);
const r = await pool.query(
  'UPDATE dashboard_users SET password_salt=$1,password_hash=$2 WHERE username=$3',
  [salt, hash, config.adminUsername]
);
console.log(r.rowCount ? `Senha de ${config.adminUsername} atualizada.` : 'Usuario nao encontrado.');
await pool.end();
