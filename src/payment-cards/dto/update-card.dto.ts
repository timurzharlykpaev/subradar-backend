import { PartialType } from '@nestjs/swagger';
import { CreatePaymentCardDto } from './create-payment-card.dto';

export class UpdatePaymentCardDto extends PartialType(CreatePaymentCardDto) {}
