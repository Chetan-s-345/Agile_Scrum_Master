#!/usr/bin/env node

/**
 * Deployment verification script for LiveKit + Deepgram migration
 * 
 * Usage:
 *   node scripts/verify-livekit-deployment.js
 * 
 * Checks:
 *   - Environment variables configured
 *   - Database schema (meeting_rooms table)
 *   - Package dependencies installed
 *   - File structure in place
 */

const fs = require('fs');
const path = require('path');

const CHECKS = [];
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
let WARN_COUNT = 0;

function pass(message, details = '') {
  CHECKS.push({ status: '✓', message, details });
  PASS_COUNT++;
}

function fail(message, details = '') {
  CHECKS.push({ status: '✗', message, details });
  FAIL_COUNT++;
}

function warn(message, details = '') {
  CHECKS.push({ status: '⚠', message, details });
  WARN_COUNT++;
}

// ============================================================================
// ENV VARS CHECK
// ============================================================================

console.log('\n📋 Checking environment variables...\n');

const requiredEnvVars = {
  'LIVEKIT_API_KEY': 'LiveKit API key (generate from https://cloud.livekit.io)',
  'LIVEKIT_API_SECRET': 'LiveKit API secret (generate from https://cloud.livekit.io)',
  'LIVEKIT_URL': 'LiveKit URL (format: wss://project.livekit.cloud)',
  'DEEPGRAM_API_KEY': 'Deepgram API key (generate from https://console.deepgram.com)',
};

const optionalEnvVars = {
  'GROQ_API_KEY': 'Groq API key for summary generation (already configured?)',
};

// Check required
for (const [varName, description] of Object.entries(requiredEnvVars)) {
  const value = process.env[varName];
  if (!value || !String(value).trim()) {
    fail(`Missing required env var: ${varName}`, description);
  } else if (varName === 'LIVEKIT_URL' && !['wss://', 'ws://', 'https://'].some(p => value.includes(p))) {
    fail(`Invalid LIVEKIT_URL format: ${value}`, 'Expected: wss://project.livekit.cloud or similar');
  } else {
    pass(`${varName} configured`);
  }
}

// Check optional
for (const [varName, description] of Object.entries(optionalEnvVars)) {
  const value = process.env[varName];
  if (!value || !String(value).trim()) {
    warn(`Optional env var not set: ${varName}`, description);
  } else {
    pass(`${varName} configured`);
  }
}

// ============================================================================
// FILE STRUCTURE CHECK
// ============================================================================

console.log('\n📁 Checking file structure...\n');

const requiredFiles = [
  // Backend service
  'cloud/backend/api-gateway/src/services/meetings.service.js',
  'cloud/backend/api-gateway/src/controllers/meetings.controller.js',
  'cloud/backend/api-gateway/src/routes/meetings.routes.js',
  'cloud/backend/api-gateway/src/validators/meetings.schemas.js',
  'cloud/backend/api-gateway/src/realtime/io.js',
  
  // Frontend hooks
  'cloud/hooks/useDeepgramTranscription.ts',
  'cloud/src/store/meetingStore.ts',
  
  // Frontend components
  'cloud/components/meetings/MeetingRoom.tsx',
  'cloud/components/meetings/MeetingsList.tsx',
  'cloud/components/meetings/MeetingSummary.tsx',
  'cloud/components/meetings/types.ts',
  
  // Frontend BFF routes
  'cloud/app/api/meetings/token/route.ts',
  'cloud/app/api/meetings/create/route.ts',
  'cloud/app/api/meetings/transcript/route.ts',
  'cloud/app/api/meetings/end/route.ts',
  'cloud/app/api/meetings/deepgram-token/route.ts',
  'cloud/app/api/meetings/route.ts',
  
  // Main page
  'cloud/app/(dashboard)/meetings/page.tsx',
  
  // Migration scripts
  'cloud/backend/api-gateway/db/migrations/add_meetings_lifecycle.js',
  
  // Documentation
  'cloud/docs/LIVEKIT_DEEPGRAM_MIGRATION.md',
];

for (const filePath of requiredFiles) {
  const fullPath = path.join(__dirname, '..', filePath);
  if (fs.existsSync(fullPath)) {
    pass(`File exists: ${filePath}`);
  } else {
    fail(`Missing file: ${filePath}`);
  }
}

// ============================================================================
// DEPENDENCIES CHECK
// ============================================================================

console.log('\n📦 Checking dependencies...\n');

const frontendPackageJson = path.join(__dirname, '../cloud/package.json');
const backendPackageJson = path.join(__dirname, '../cloud/backend/api-gateway/package.json');

const frontendRequired = [
  '@livekit/components-react',
  '@livekit/components-styles',
  'livekit-client',
  '@deepgram/sdk',
];

const backendRequired = [
  'livekit-server-sdk',
  '@deepgram/sdk',
];

// Check frontend
if (fs.existsSync(frontendPackageJson)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(frontendPackageJson, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    for (const dep of frontendRequired) {
      if (allDeps[dep]) {
        pass(`Frontend dependency: ${dep} (${allDeps[dep]})`);
      } else {
        fail(`Missing frontend dependency: ${dep}`, 
             `Run: cd cloud && npm install ${dep}`);
      }
    }
  } catch (e) {
    fail(`Could not parse cloud/package.json: ${e.message}`);
  }
} else {
  fail(`Missing cloud/package.json`);
}

// Check backend
if (fs.existsSync(backendPackageJson)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(backendPackageJson, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    for (const dep of backendRequired) {
      if (allDeps[dep]) {
        pass(`Backend dependency: ${dep} (${allDeps[dep]})`);
      } else {
        fail(`Missing backend dependency: ${dep}`,
             `Run: cd cloud/backend/api-gateway && npm install ${dep}`);
      }
    }
  } catch (e) {
    fail(`Could not parse cloud/backend/api-gateway/package.json: ${e.message}`);
  }
} else {
  fail(`Missing cloud/backend/api-gateway/package.json`);
}

// ============================================================================
// SCHEMA CHECK
// ============================================================================

console.log('\n🗄️  Checking database schema...\n');

// Check migration script contains meeting_rooms table
const migrationPath = path.join(__dirname, '../cloud/backend/api-gateway/db/migrations/add_meetings_lifecycle.js');
if (fs.existsSync(migrationPath)) {
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');
  
  if (migrationContent.includes('CREATE TABLE IF NOT EXISTS meeting_rooms')) {
    pass('Migration script includes meeting_rooms table creation');
  } else {
    fail('Migration script missing meeting_rooms table');
  }
  
  if (migrationContent.includes("CHECK (video_provider IN ('none', 'livekit'")) {
    pass('Migration script updated video_provider enum to include livekit');
  } else {
    warn('Migration script may not have updated video_provider enum');
  }
  
  if (migrationContent.includes("CHECK (source_type IN ('manual_upload', 'livekit'")) {
    pass('Migration script updated source_type enum to include livekit');
  } else {
    warn('Migration script may not have updated source_type enum');
  }
} else {
  fail('Migration script not found at db/migrations/add_meetings_lifecycle.js');
}

// Check init.sql files
const backendInitPath = path.join(__dirname, '../cloud/backend/api-gateway/init.sql');
if (fs.existsSync(backendInitPath)) {
  const initContent = fs.readFileSync(backendInitPath, 'utf8');
  
  if (initContent.includes('CREATE TABLE IF NOT EXISTS meeting_rooms')) {
    pass('Backend init.sql includes meeting_rooms table');
  } else {
    warn('Backend init.sql may be missing meeting_rooms table');
  }
  
  if (initContent.includes("'livekit'")) {
    pass('Backend init.sql includes livekit provider');
  } else {
    warn('Backend init.sql may not include livekit provider');
  }
} else {
  warn('Backend init.sql not found (not critical if migration is run)');
}

// ============================================================================
// PRINT SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('DEPLOYMENT VERIFICATION SUMMARY');
console.log('='.repeat(80) + '\n');

CHECKS.forEach(({ status, message, details }) => {
  console.log(`${status} ${message}`);
  if (details) console.log(`  → ${details}`);
});

console.log('\n' + '='.repeat(80));
console.log(`✓ Passed: ${PASS_COUNT} | ✗ Failed: ${FAIL_COUNT} | ⚠ Warnings: ${WARN_COUNT}`);
console.log('='.repeat(80) + '\n');

if (FAIL_COUNT > 0) {
  console.log('🚫 DEPLOYMENT NOT READY\n');
  console.log('Please fix the above failures before deploying.\n');
  process.exit(1);
} else if (WARN_COUNT > 0) {
  console.log('⚠️  READY WITH WARNINGS\n');
  console.log('Please review the warnings above and ensure they are expected.\n');
  process.exit(0);
} else {
  console.log('✅ READY FOR DEPLOYMENT\n');
  console.log('Next steps:');
  console.log('  1. Run migration: node backend/api-gateway/db/migrations/add_meetings_lifecycle.js');
  console.log('  2. Deploy to production');
  console.log('  3. Test end-to-end: Start a meeting and verify transcript capture\n');
  process.exit(0);
}
