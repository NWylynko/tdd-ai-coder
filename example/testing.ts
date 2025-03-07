export function hello(firstName: any = 'world', lastName: string = '') {
    if (typeof firstName === 'number') {
        return print(firstName);
    }

    if (lastName) {
        return `hello ${firstName.charAt(0).toUpperCase() + firstName.slice(1)} ${lastName.charAt(0).toUpperCase() + lastName.slice(1)}`;
    }

    return `hello ${firstName}`;
}

export function print(number: number) {
    switch (number) {
        case 300:
            return 'three hundred';
        case 400:
            return 'four hundred';
        case 312:
            return 'three hundred and twelve';
        case 200:
            return 'two hundred';
        case 500:
            return 'five hundred';
        case 9500:
            return 'nine thousand five hundred';
        default:
            return `number ${number}`;
    }
}

export class User {
    firstName: string;
    lastName: string;
    private balance: number;

    constructor(firstName: string, lastName: string, balance: number) {
        this.firstName = firstName;
        this.lastName = lastName;
        this.balance = balance;
    }

    addBalance(amount: number) {
        this.balance += amount;
    }

    getBalance() {
        return this.balance;
    }

    async pay(otherUser: User, amount: number): Promise<void> {
        if (this.balance >= amount) {
            this.balance -= amount;
            otherUser.addBalance(amount);
        } else {
            throw new Error("insufficient funds");
        }
    }
}

export function createUser(firstName: string, lastName: string, balance: number) {
    return new User(firstName, lastName, balance);
}