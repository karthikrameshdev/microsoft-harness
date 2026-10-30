import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillDefinition } from '../types/index.ts';
import {
  validateSkillReferences,
  MAX_SKILL_NAME_LENGTH,
  SKILL_NAME_REGEX,
  FoundryLimitsError,
} from '../config/foundry-limits.ts';

export const MAX_SKILL_FILE_SIZE_BYTES = 256 * 1024; // 256 KiB limit from Copilot SDK

export interface SkillInstallationRecord {
  name: string;
  version: string;
  enabled: boolean;
  targetPath: string;
  installedAt: string;
  definition: SkillDefinition;
}

export class SkillEngine {
  private skills = new Map<string, SkillInstallationRecord>();

  private baseSkillsDir?: string;

  constructor(baseSkillsDir?: string) {
    this.baseSkillsDir = baseSkillsDir;
    if (this.baseSkillsDir && fs.existsSync(this.baseSkillsDir)) {
      this.loadSkillsFromDirectory(this.baseSkillsDir);
    }
  }

  public parseSkillFile(filePath: string): SkillDefinition {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_SKILL_FILE_SIZE_BYTES) {
      throw new FoundryLimitsError(
        `Skill file '${filePath}' exceeds 256 KiB limit (size: ${stats.size} bytes).`,
        'SKILL_FILE_TOO_LARGE'
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    let name = path.basename(path.dirname(filePath));
    let description = '';
    let version = '1.0.0';
    const preconditions: string[] = [];
    const permittedSources: string[] = [];
    let instructions = content;

    if (frontmatterMatch) {
      const yaml = frontmatterMatch[1];
      instructions = frontmatterMatch[2].trim();

      for (const line of yaml.split('\n')) {
        const [k, ...v] = line.split(':');
        if (!k || v.length === 0) continue;
        const key = k.trim();
        const val = v.join(':').trim();

        if (key === 'name') name = val;
        if (key === 'description') description = val;
        if (key === 'version') version = val;
      }
    }

    if (!SKILL_NAME_REGEX.test(name) || name.length > MAX_SKILL_NAME_LENGTH) {
      throw new FoundryLimitsError(
        `Invalid skill name '${name}'. Must be <= ${MAX_SKILL_NAME_LENGTH} chars and match ${SKILL_NAME_REGEX}.`,
        'INVALID_SKILL_NAME'
      );
    }

    return {
      name,
      description,
      version,
      preconditions,
      permittedSources,
      outputSchema: {},
      instructions,
      rawMarkdown: content,
    };
  }

  public loadSkillsFromDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const def = this.parseSkillFile(skillFile);
          this.skills.set(def.name, {
            name: def.name,
            version: def.version,
            enabled: true,
            targetPath: skillFile,
            installedAt: new Date().toISOString(),
            definition: def,
          });
        }
      }
    }

    // Validate that total installed skills do not exceed 50 top-level skill limit
    validateSkillReferences(Array.from(this.skills.keys()));
  }

  // Copilot SDK Skill APIs
  public planInstall(skillPath: string): { name: string; version: string; sizeBytes: number } {
    const def = this.parseSkillFile(skillPath);
    const size = Buffer.byteLength(def.rawMarkdown, 'utf-8');
    return { name: def.name, version: def.version, sizeBytes: size };
  }

  public applyInstall(skillPath: string): SkillInstallationRecord {
    const def = this.parseSkillFile(skillPath);
    const currentNames = Array.from(this.skills.keys());
    if (!this.skills.has(def.name)) {
      validateSkillReferences([...currentNames, def.name]);
    }

    const record: SkillInstallationRecord = {
      name: def.name,
      version: def.version,
      enabled: true,
      targetPath: skillPath,
      installedAt: new Date().toISOString(),
      definition: def,
    };
    this.skills.set(def.name, record);
    return record;
  }

  public setEnabled(skillName: string, enabled: boolean): void {
    const record = this.skills.get(skillName);
    if (!record) throw new Error(`Skill '${skillName}' is not installed.`);
    record.enabled = enabled;
  }

  public listInstallations(): SkillInstallationRecord[] {
    return Array.from(this.skills.values());
  }

  public getSkill(name: string): SkillDefinition | undefined {
    const record = this.skills.get(name);
    return record?.enabled ? record.definition : undefined;
  }
}
