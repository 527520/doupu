export type MailAdapter = 'smtp' | 'ses' | 'fake';
type Environment = Record<string, string | undefined>;

export function resolveMailAdapter(env: Environment = process.env): MailAdapter {
  if (env.SMTP_HOST) return 'smtp';
  if (env.SES_SECRET_ID) return 'ses';
  if (env.NODE_ENV === 'production') {
    throw new Error('production mail adapter is not configured (SMTP_* or SES_* required)');
  }
  return 'fake';
}

function requireValues(env: Environment, names: string[], label: string): void {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`${label} is incomplete; missing ${missing.join(', ')}`);
}

/** 启动期校验；生产绝不静默回退到日志/fake 适配器。 */
export function validateProductionAuthAdapters(env: Environment = process.env): { mail: Exclude<MailAdapter, 'fake'> } | null {
  if (env.NODE_ENV !== 'production') return null;
  if (!env.APP_URL?.startsWith('https://')) {
    throw new Error('APP_URL must be an https URL in production (e.g. https://your-domain)');
  }
  const mail = resolveMailAdapter(env);
  if (mail === 'fake') throw new Error('production mail adapter cannot use fake mode');
  if (mail === 'smtp') {
    requireValues(env, ['SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'], 'SMTP adapter');
  } else {
    requireValues(
      env,
      ['SES_SECRET_KEY', 'SES_FROM', 'SES_VERIFY_TEMPLATE_ID', 'SES_RESET_TEMPLATE_ID', 'SES_ALERT_TEMPLATE_ID'],
      'SES adapter',
    );
  }
  requireValues(env, ['BACKUP_ALERT_TOKEN', 'ADMIN_EMAIL'], 'backup alert adapter');
  if ((env.BACKUP_ALERT_TOKEN?.length ?? 0) < 16) {
    throw new Error('BACKUP_ALERT_TOKEN must contain at least 16 characters');
  }
  return { mail };
}
