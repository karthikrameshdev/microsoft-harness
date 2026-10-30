import type { FoundryRegion, NativeCapability } from '../types/index.ts';

/**
 * Microsoft Foundry Copilot Harness (Public Preview) Limits, Quotas & Guardrails
 * Based on: https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions
 */

export const SUPPORTED_REGIONS: readonly FoundryRegion[] = [
  'australiaeast',
  'canadacentral',
  'centralus',
  'germanywestcentral',
  'japaneast',
  'swedencentral',
  'uksouth',
  'westeurope',
  'westus',
] as const;

export const NATIVE_CAPABILITIES: readonly NativeCapability[] = [
  'file_read',
  'file_write',
  'shell',
  'web',
  'subagents',
] as const;

export const HARNESS_MANAGED_AGENT_SETTINGS = [
  'temperature',
  'top_p',
  'tool_choice',
  'text.format',
  'text.verbosity',
] as const;

export const HARNESS_MANAGED_RESPONSE_SETTINGS = [
  'max_output_tokens',
  'max_tool_calls',
  'parallel_tool_calls',
  'truncation',
  'context_management',
  'top_logprobs',
  'safety_identifier',
  'prompt_cache_key',
  'prompt_cache_retention',
  'service_tier',
  'user',
] as const;

export const MAX_TOP_LEVEL_SKILLS = 50;
export const MAX_SKILL_NAME_LENGTH = 64;
export const SKILL_NAME_REGEX = /^[a-z0-9-]+$/;
export const RESERVED_FUNCTION_SEPARATOR = '___';

export class FoundryLimitsError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(`[Foundry Limits Error] ${message}`);
    this.name = 'FoundryLimitsError';
    this.code = code;
  }
}

/**
 * Validates whether the given region is supported by the Copilot Harness preview
 */
export function validateFoundryRegion(region: string): FoundryRegion {
  const normalized = region.toLowerCase().replace(/[\s-_]/g, '') as FoundryRegion;
  if (!SUPPORTED_REGIONS.includes(normalized)) {
    throw new FoundryLimitsError(
      `Region '${region}' is not supported in Copilot Harness public preview. Supported regions are: ${SUPPORTED_REGIONS.join(', ')}`,
      'UNSUPPORTED_REGION'
    );
  }
  return normalized;
}

/**
 * Rejects BYOM (Bring Your Own Model) attempts in Foundry preview
 */
export function validateModelSupport(modelId: string, isCustomHosted: boolean): void {
  if (isCustomHosted) {
    throw new FoundryLimitsError(
      `Bring your own model (BYOM) is not supported in the Copilot Harness public preview. Only project-region supported reasoning/tool models can be used.`,
      'BYOM_NOT_SUPPORTED'
    );
  }
  if (!modelId || typeof modelId !== 'string') {
    throw new FoundryLimitsError('A valid model identifier must be specified.', 'INVALID_MODEL');
  }
}

/**
 * Validates skill names, format, and quota limits
 */
export function validateSkillReferences(skillNames: string[]): void {
  if (skillNames.length > MAX_TOP_LEVEL_SKILLS) {
    throw new FoundryLimitsError(
      `Maximum top-level skill limit exceeded: got ${skillNames.length}, maximum is ${MAX_TOP_LEVEL_SKILLS}.`,
      'MAX_SKILLS_EXCEEDED'
    );
  }

  const seen = new Set<string>();
  for (const name of skillNames) {
    if (seen.has(name)) {
      throw new FoundryLimitsError(`Duplicate skill reference '${name}'. Skill names must be unique.`, 'DUPLICATE_SKILL');
    }
    seen.add(name);

    if (name.length > MAX_SKILL_NAME_LENGTH) {
      throw new FoundryLimitsError(
        `Skill name '${name}' exceeds max length of ${MAX_SKILL_NAME_LENGTH} characters.`,
        'SKILL_NAME_TOO_LONG'
      );
    }

    if (!SKILL_NAME_REGEX.test(name)) {
      throw new FoundryLimitsError(
        `Skill name '${name}' is invalid. Skill names must use only lowercase letters, digits, and hyphens.`,
        'INVALID_SKILL_NAME_FORMAT'
      );
    }
  }
}

/**
 * Validates custom function tools against Foundry preview rules:
 * - Non-strict schemas only (strict: true is prohibited)
 * - Cannot contain the reserved separator '___'
 * - Cannot conflict with native harness tool names
 */
export function validateFunctionTool(name: string, schema: Record<string, unknown>): void {
  if (name.includes(RESERVED_FUNCTION_SEPARATOR)) {
    throw new FoundryLimitsError(
      `Function tool name '${name}' contains reserved separator '${RESERVED_FUNCTION_SEPARATOR}'.`,
      'RESERVED_FUNCTION_SEPARATOR'
    );
  }

  if (NATIVE_CAPABILITIES.includes(name as NativeCapability)) {
    throw new FoundryLimitsError(
      `Function tool name '${name}' conflicts with native harness capability.`,
      'NATIVE_CAPABILITY_CONFLICT'
    );
  }

  if (schema.strict === true) {
    throw new FoundryLimitsError(
      `Function tool '${name}' specified 'strict: true', which is not supported in Copilot Harness preview. Use non-strict schemas.`,
      'STRICT_SCHEMA_NOT_SUPPORTED'
    );
  }
}

/**
 * Verifies that the caller is not trying to override harness-managed response settings
 */
export function validateCallerResponseSettings(settings: Record<string, unknown>): void {
  for (const key of HARNESS_MANAGED_RESPONSE_SETTINGS) {
    if (key in settings && settings[key] !== undefined) {
      throw new FoundryLimitsError(
        `Setting '${key}' is managed by the Copilot Harness runtime and cannot be overridden by the caller.`,
        'HARNESS_MANAGED_SETTING_OVERRIDE'
      );
    }
  }

  // Session continuity: store: false is prohibited
  if ('store' in settings && settings.store === false) {
    throw new FoundryLimitsError(
      `'store: false' is not supported in Copilot Harness preview. Responses must be stored with conversation continuity.`,
      'STORE_FALSE_NOT_SUPPORTED'
    );
  }

  if ('previous_response_id' in settings && settings.previous_response_id) {
    throw new FoundryLimitsError(
      `'previous_response_id' is not supported. Harness uses conversation-scoped continuity.`,
      'PREVIOUS_RESPONSE_ID_NOT_SUPPORTED'
    );
  }
}
