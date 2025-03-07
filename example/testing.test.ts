// example/calculator.test.ts
import { describe, it, expect } from 'vitest';
import * as test from './testing';

describe('Tests', () => {
  it('should succeed', () => {
    expect(test.hello()).toBe('hello world');

    expect(test.hello("nick")).toBe("hello nick");

    expect(test.hello("nick", "wylynko")).toBe("hello Nick Wylynko");

    expect(test.print(300)).toBe("three hundred");
    expect(test.print(400)).toBe("four hundred");
    expect(test.print(312)).toBe("three hundred and twelve");

    const user = test.createUser("nick", "wylynko", 100);

    expect(user.firstName).toBe("nick");

    user.addBalance(100);

    expect(user.getBalance()).toBe(200);
    expect(test.print(user.getBalance())).toBe("two hundred");

    const user2 = test.createUser("bob", "smith", 10_000);

    user2.pay(user, 500)

    expect(user2.getBalance()).toBe(9_500);
    expect(user.getBalance()).toBe(700);

  })
});