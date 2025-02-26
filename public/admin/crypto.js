const CryptoJS = require("crypto-js");

// SUA CHAVE REAL DO PRINTFUL (NÃO COMPARTILHE)
const PRINTFUL_API_KEY = "4PxIrgbx9DXz4zfhsIysrhU4ut7aFFcU9fZGDcau";

// 🔒 Segredo de criptografia (use algo difícil de adivinhar)
const ENCRYPTION_SECRET = "segredo_super_secreto";

// Criptografar a chave da API
const encryptedKey = CryptoJS.AES.encrypt(PRINTFUL_API_KEY, ENCRYPTION_SECRET).toString();

console.log("Chave criptografada:", encryptedKey);
