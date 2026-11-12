import type { Role, User } from "./types";

export const USERS: User[] = [
  { id: "u1", username: "vihar.supplier", password: "Vihar@2026", displayName: "Vihar Chem Supplies", title: "Supplier", role: "supplier", vendorId: "V-1001" },
  { id: "u2", username: "konkan.supplier", password: "Konkan@2026", displayName: "Konkan Packaging Works", title: "Supplier", role: "supplier", vendorId: "V-1002" },
  { id: "u3", username: "priya.clerk", password: "Clerk@2026", displayName: "Priya Nair", title: "AP Clerk", role: "clerk" },
  { id: "u4", username: "neha.approver", password: "ApproverL1@2026", displayName: "Neha Kulkarni", title: "Approver L1 · Finance Manager", role: "approver", approverLevel: "L1" },
  { id: "u5", username: "rajesh.approver", password: "ApproverL2@2026", displayName: "Rajesh Menon", title: "Approver L2 · Finance Controller", role: "approver", approverLevel: "L2" },
];

export function findUser(username: string): User | undefined {
  return USERS.find((u) => u.username === username);
}

export const ROLE_HOME: Record<Role, string> = {
  supplier: "/supplier",
  clerk: "/clerk",
  approver: "/approver",
};

export const ROLE_LABEL: Record<Role, string> = {
  supplier: "Supplier",
  clerk: "AP Clerk",
  approver: "Approver",
};
