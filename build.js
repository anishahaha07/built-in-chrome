#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = __dirname;
const envPath = path.join(root, '.env');
const manifestTemplatePath = path.join(root, 'manifest.template.json');
const manifestOutputPath = path.join(root, 'manifest.json');
const configOutputPath = path.join(root, 'config.json');

function parseDotEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env file. Create one based on .env.example');
    process.exit(1);
  }

  const env = parseDotEnv(fs.readFileSync(envPath, 'utf8'));

  const clientId = env.OAUTH_CLIENT_ID;
  const geminiKey = env.GEMINI_API_KEY;

  if (!clientId) {
    console.error('Missing OAUTH_CLIENT_ID in .env');
    process.exit(1);
  }
  if (!geminiKey) {
    console.error('Missing GEMINI_API_KEY in .env');
    process.exit(1);
  }

  const manifestTemplate = JSON.parse(fs.readFileSync(manifestTemplatePath, 'utf8'));
  const manifest = JSON.parse(JSON.stringify(manifestTemplate).replace(/__OAUTH_CLIENT_ID__/g, clientId));

  fs.writeFileSync(manifestOutputPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(configOutputPath, JSON.stringify({ geminiApiKey: geminiKey }, null, 2));

  console.log('Generated manifest.json and config.json');
}

main();


