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
    LOGIN = 'LOGIN',
    LOGOUT = 'LOGOUT',
    ACCOUNT_CREATE = 'ACCOUNT_CREATE',
    ACCOUNT_FREEZE = 'ACCOUNT_FREEZE',
    ACCOUNT_UNFREEZE = 'ACCOUNT_UNFREEZE',
    ACCOUNT_CLOSE = 'ACCOUNT_CLOSE',
    PASSWORD_CHANGE = 'PASSWORD_CHANGE',
    REGISTER = 'REGISTER',
    REFRESH = 'REFRESH',
}

export enum EventType {
    TRANSACTION_COMPLETED = 'TRANSACTION_COMPLETED',
    TRANSACTION_FAILED = 'TRANSACTION_FAILED',
}

export enum EventStatus {
    PENDING = 'PENDING',
    PROCESSED = 'PROCESSED',
    FAILED = 'FAILED',
}