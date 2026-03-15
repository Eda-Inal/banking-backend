import { HttpException, HttpStatus } from "@nestjs/common";

export class AccountLockedException extends HttpException {
    constructor(message: string) {
        super(message, HttpStatus.LOCKED);
    }
}