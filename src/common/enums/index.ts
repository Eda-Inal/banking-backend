export enum Currency {
    TRY = 'TRY',
    USD = 'USD',
    EUR = 'EUR',
}
export enum AccountStatus {
    ACTIVE = 'ACTIVE',
    FROZEN = 'FROZEN',
    CLOSED = 'CLOSED',
}

export enum TransactionType {
    DEPOSIT = 'DEPOSIT',
    WITHDRAW = 'WITHDRAW',
    TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    REJECTED = 'REJECTED',
}

export enum Action {
    DEPOSIT = 'DEPOSIT',
    WITHDRAW = 'WITHDRAW',
    TRANSFER = 'TRANSFER',
}

export enum EventType {
    TRANSACTION_COMPLETED = 'TRANSACTION_COMPLETED',
}

export enum EventStatus {
    PENDING = 'PENDING',
    PROCESSED = 'PROCESSED',
    FAILED = 'FAILED',
}