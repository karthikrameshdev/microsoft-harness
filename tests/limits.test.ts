import test from 'node:test';
import * as assert from 'node:assert';
import {
  validateFoundryRegion,
  validateModelSupport,
  validateSkillReferences,
  validateFunctionTool,
  validateCallerResponseSettings,
  FoundryLimitsError,
} from '../src/config/foundry-limits.ts';

test('Foundry Limits: Supported regions validation', () => {
  assert.strictEqual(validateFoundryRegion('westus'), 'westus');
  assert.strictEqual(validateFoundryRegion('Canada Central'), 'canadacentral');
  assert.strictEqual(validateFoundryRegion('germanywestcentral'), 'germanywestcentral');

  assert.throws(
    () => validateFoundryRegion('eastus2'),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'UNSUPPORTED_REGION');
      return true;
    }
  );
});

test('Foundry Limits: BYOM rejection in preview', () => {
  // Region-supported models pass
  assert.doesNotThrow(() => validateModelSupport('o3-mini', false));

  // Custom-hosted BYOM must be rejected
  assert.throws(
    () => validateModelSupport('custom-fine-tuned-model', true),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'BYOM_NOT_SUPPORTED');
      return true;
    }
  );
});

test('Foundry Limits: Top-level skills quota and naming constraints', () => {
  // Valid skill names
  assert.doesNotThrow(() =>
    validateSkillReferences(['incident-brief', 'schema-validator', 'auth-check-1'])
  );

  // Duplicate skill reference
  assert.throws(
    () => validateSkillReferences(['incident-brief', 'incident-brief']),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'DUPLICATE_SKILL');
      return true;
    }
  );

  // Invalid character in skill name (uppercase or symbols)
  assert.throws(
    () => validateSkillReferences(['Incident_Brief!']),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'INVALID_SKILL_NAME_FORMAT');
      return true;
    }
  );

  // Exceeding 50 skill limit
  const tooManySkills = Array.from({ length: 51 }, (_, i) => `skill-${i}`);
  assert.throws(
    () => validateSkillReferences(tooManySkills),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'MAX_SKILLS_EXCEEDED');
      return true;
    }
  );
});

test('Foundry Limits: Function tools schema restrictions', () => {
  // Valid non-strict tool
  assert.doesNotThrow(() =>
    validateFunctionTool('query_telemetry', { type: 'object', strict: false })
  );

  // Prohibited strict: true
  assert.throws(
    () => validateFunctionTool('query_telemetry', { type: 'object', strict: true }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'STRICT_SCHEMA_NOT_SUPPORTED');
      return true;
    }
  );

  // Reserved separator '___'
  assert.throws(
    () => validateFunctionTool('my_tool___sub', { type: 'object' }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'RESERVED_FUNCTION_SEPARATOR');
      return true;
    }
  );

  // Conflict with native harness capability name
  assert.throws(
    () => validateFunctionTool('file_read', { type: 'object' }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'NATIVE_CAPABILITY_CONFLICT');
      return true;
    }
  );
});

test('Foundry Limits: Caller cannot override harness-managed settings', () => {
  // Overriding max_output_tokens
  assert.throws(
    () => validateCallerResponseSettings({ max_output_tokens: 4096 }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'HARNESS_MANAGED_SETTING_OVERRIDE');
      return true;
    }
  );

  // store: false is prohibited
  assert.throws(
    () => validateCallerResponseSettings({ store: false }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'STORE_FALSE_NOT_SUPPORTED');
      return true;
    }
  );

  // previous_response_id is prohibited
  assert.throws(
    () => validateCallerResponseSettings({ previous_response_id: 'resp-123' }),
    (err: unknown) => {
      assert.ok(err instanceof FoundryLimitsError);
      assert.strictEqual(err.code, 'PREVIOUS_RESPONSE_ID_NOT_SUPPORTED');
      return true;
    }
  );
});
