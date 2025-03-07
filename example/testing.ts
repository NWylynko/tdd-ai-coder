export function hello(firstName: string = 'world', lastName: string = '') {
  return `hello ${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();
}