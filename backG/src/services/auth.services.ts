export const signup = (
  email: string,
  password: string,
): { result: boolean; message: string } => {
  // if email exists return false
  // else add to db and return True
  return { result: true, message: "" };
};

export const login = (
  email: string,
  password: string,
): { result: boolean; message: string } => {
  return { result: true, message: "" };
};
