// example/calculator.test.ts
import { describe, it, expect } from 'vitest';
import * as test from './testing';

describe('Tests', () => {
  it('should succeed', () => {
    expect(test.hello()).toBe('hello world');

    expect(test.hello("nick")).toBe("hello nick");

    expect(test.hello("nick", "wylynko")).toBe("hello Nick Wylynko");
  })
});