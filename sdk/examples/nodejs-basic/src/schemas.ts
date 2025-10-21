import { z } from '@realdb/client';

// User Schema - for user management and authentication
export const UserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  age: z.number().int().min(0, 'Age must be positive').optional(),
  active: z.boolean().default(true)
});

// Product Schema - for e-commerce and inventory
export const ProductSchema = z.object({
  name: z.string().min(1, 'Product name required'),
  price: z.number().positive('Price must be positive'),
  category: z.string().min(1, 'Category required'),
  inStock: z.boolean().default(true),
  tags: z.array(z.string()).optional()
});

// Todo Schema - for task management and CRUD operations
export const TodoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high'], {
    message: 'Priority must be low, medium, or high'
  }),
  dueDate: z.string().optional(), // Using optional string for easier handling
  tags: z.array(z.string()).optional()
});

// Message Schema - for real-time chat and messaging
export const MessageSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  content: z.string().min(1, 'Message content is required'),
  channel: z.string().min(1, 'Channel is required'),
  timestamp: z.string().optional() // Using optional string for easier handling
});

// Extended schemas that include database fields (id, createdAt, updatedAt)
export const TodoWithMetaSchema = TodoSchema.extend({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const UserWithMetaSchema = UserSchema.extend({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const ProductWithMetaSchema = ProductSchema.extend({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const MessageWithMetaSchema = MessageSchema.extend({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

// Export inferred types for TypeScript usage
export type User = z.infer<typeof UserSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Todo = z.infer<typeof TodoSchema>;
export type Message = z.infer<typeof MessageSchema>;

// Export extended types with database metadata
export type UserWithMeta = z.infer<typeof UserWithMetaSchema>;
export type ProductWithMeta = z.infer<typeof ProductWithMetaSchema>;
export type TodoWithMeta = z.infer<typeof TodoWithMetaSchema>;
export type MessageWithMeta = z.infer<typeof MessageWithMetaSchema>;

// Export all schemas as a collection for easy iteration
export const AllSchemas = {
  user: UserSchema,
  product: ProductSchema,
  todo: TodoSchema,
  message: MessageSchema
} as const;

// Table name mappings
export const TableNames = {
  users: 'users',
  products: 'products',
  todos: 'todos',
  messages: 'messages'
} as const;

// Schema-to-table mapping for automatic setup
export const SchemaTableMapping = {
  [TableNames.users]: UserSchema,
  [TableNames.products]: ProductSchema,
  [TableNames.todos]: TodoSchema,
  [TableNames.messages]: MessageSchema
} as const;