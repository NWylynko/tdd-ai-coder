// example/calculator.test.ts
import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from './calculator';

describe('Calculator', () => {
  it('should add two numbers', () => {
    expect(add(1, 2)).toBe(3);
    expect(add(-1, 1)).toBe(0);
    expect(add(0, 0)).toBe(0);
  });

  it('should subtract two numbers', () => {
    expect(subtract(3, 2)).toBe(1);
    expect(subtract(2, 3)).toBe(-1);
    expect(subtract(0, 0)).toBe(0);
  });

  it('should multiply two numbers', () => {
    expect(multiply(2, 3)).toBe(6);
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(0, 5)).toBe(0);
  });

  it('should divide two numbers', () => {
    expect(divide(6, 2)).toBe(3);
    expect(divide(5, 2)).toBe(2.5);
    expect(divide(-6, 2)).toBe(-3);
  });

  it('should throw an error when dividing by zero', () => {
    expect(() => divide(6, 0)).toThrow('Division by zero');
  });
});