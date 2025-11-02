import { z } from 'zod';

// Message schema for chat messages
export const MessageSchema = z.object({
  id: z.string().optional(), // Auto-generated primary key (always added by the system)
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content cannot be empty'),
  userId: z.string().min(1, 'User ID is required'),
  username: z.string().min(1, 'Username is required'), // Secondary key candidate for GSI
  timestamp: z.string().optional(), // Will be auto-generated
  editedAt: z.string().optional(), // For tracking edits
  isEdited: z.boolean().default(false),
});

export type Message = z.infer<typeof MessageSchema>;

// Table names
export const ChatTableNames = {
  messages: 'messages',
} as const;