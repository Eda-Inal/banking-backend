import { IsNotEmpty, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateDepositRequestDto {
    @IsNotEmpty()
    @IsNumber()
    @Min(0.01)
    @Max(9999999999999999.99)
    amount: number;

    @IsNotEmpty()
    @IsString()
    referenceId: string;

    @IsNotEmpty()
    @IsUUID()
    toAccountId: string;
}