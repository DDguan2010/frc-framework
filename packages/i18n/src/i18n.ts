import { en, zhCN, type TranslationKey } from './translations.js';

export type SupportedLocale = 'en' | 'zh-CN';

export class I18n extends EventTarget {
  #locale: SupportedLocale;

  constructor(locale: SupportedLocale = 'en') {
    super();
    this.#locale = locale;
  }

  get locale(): SupportedLocale {
    return this.#locale;
  }

  setLocale(locale: SupportedLocale): void {
    if (locale !== this.#locale) {
      this.#locale = locale;
      this.dispatchEvent(new Event('change'));
    }
  }

  t(key: TranslationKey, values: Readonly<Record<string, string | number>> = {}): string {
    const template = (this.#locale === 'zh-CN' ? zhCN : en)[key];
    return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (_, name: string) =>
      values[name] === undefined ? `{${name}}` : String(values[name]),
    );
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.#locale, options).format(value);
  }

  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.#locale, options).format(value);
  }

  formatUnit(value: number, unit: NonNullable<Intl.NumberFormatOptions['unit']>): string {
    return this.formatNumber(value, { style: 'unit', unit, unitDisplay: 'short' });
  }

  plural(
    value: number,
    forms: Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>,
  ): string {
    const rule = new Intl.PluralRules(this.#locale).select(value);
    return forms[rule] ?? forms.other;
  }
}

export function resolveLocale(language: string): SupportedLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
