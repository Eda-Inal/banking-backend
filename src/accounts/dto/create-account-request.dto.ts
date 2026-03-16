import { IsNotEmpty, IsEnum } from 'class-validator';
import { Currency } from '../../common/enums';

export class CreateAccountRequestDto {
    @IsNotEmpty()
    @IsEnum(Currency)
    currency: Currency;
    
}