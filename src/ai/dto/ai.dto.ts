
export class WizardDto {
  message!: string;
  context?: {
    name?: string;
    amount?: number;
    currency?: string;
    billingPeriod?: string;
    category?: string;
  };
  locale?: string;
}
