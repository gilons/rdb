import { config } from 'dotenv';
import { RdbClient } from '@realdb/client';
import { TodoSchema, TodoWithMeta, TableNames } from './schemas';

// Load environment variables
config();

async function crudDemo(): Promise<void> {
  console.log('💾 RDB CRUD Operations Demo');
  console.log('===========================\n');

  // Validate environment
  if (!process.env.RDB_ENDPOINT || !process.env.RDB_API_KEY) {
    console.error('❌ Missing environment variables. Check your .env file.');
    process.exit(1);
  }

  try {
    // Initialize client
    const client = new RdbClient({
      endpoint: process.env.RDB_ENDPOINT,
      apiKey: process.env.RDB_API_KEY,
    });

    console.log('✅ RDB Client initialized');

    // Setup and run CRUD operations
    await setupTodosTable(client);
    await demonstrateCreateOperations(client);
    await demonstrateReadOperations(client);
    await demonstrateDeleteOperations(client);

    console.log('\n🎉 CRUD Demo completed successfully!');
    console.log('\n💡 Note: This demo shows the available SDK operations.');
    console.log('   Update operations and advanced querying require additional API endpoints.');

  } catch (error) {
    console.error('❌ Error in CRUD demo:', error);
    process.exit(1);
  }
}

async function setupTodosTable(client: RdbClient): Promise<void> {
  console.log('📋 Setting up todos table...');
  
  try {
    await client.createTableFromSchema(TableNames.todos, TodoSchema, {
      description: 'Todo list for CRUD demonstration with Zod validation'
    });
    console.log('✅ Todos table created from Zod schema');
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Todos table already exists');
    } else {
      throw error;
    }
  }
}

async function demonstrateCreateOperations(client: RdbClient): Promise<string[]> {
  console.log('\n📝 CREATE Operations');
  console.log('--------------------');

  // Use schema-based table instance for validation and type safety
  const todos = client.tableWithSchema(TableNames.todos, TodoSchema);
  const createdIds: string[] = [];

  // Create individual todos with automatic validation
  console.log('Creating individual todos with Zod validation...');

  const todo1Response = await todos.create({
    title: 'Learn RDB SDK',
    description: 'Go through the TypeScript examples and understand the API',
    completed: false,
    priority: 'high',
    dueDate: '2024-01-15',
    tags: ['learning', 'development']
  });
  const todo1 = todo1Response.data as TodoWithMeta;
  if (todo1?.id) createdIds.push(todo1.id);
  console.log(`✅ Created: "${todo1?.title || 'Todo'}" (ID: ${todo1?.id})`);

  const todo2Response = await todos.create({
    title: 'Write unit tests',
    description: 'Add comprehensive test coverage for the new features',
    completed: false,
    priority: 'medium',
    dueDate: '2024-01-20',
    tags: ['testing', 'quality']
  });
  const todo2 = todo2Response.data as TodoWithMeta;
  if (todo2?.id) createdIds.push(todo2.id);
  console.log(`✅ Created: "${todo2?.title || 'Todo'}" (ID: ${todo2?.id})`);

  const todo3Response = await todos.create({
    title: 'Deploy to production',
    description: 'Deploy the latest version to production environment',
    completed: false,
    priority: 'low',
    tags: ['deployment']
  });
  const todo3 = todo3Response.data as TodoWithMeta;
  if (todo3?.id) createdIds.push(todo3.id);
  console.log(`✅ Created: "${todo3?.title || 'Todo'}" (ID: ${todo3?.id})`);

  // Create additional todos individually (batch operations not available in current SDK)
  console.log('\nCreating additional todos...');
  const moreTodos = [
    {
      title: 'Code review',
      completed: false,
      priority: 'medium' as const,
      tags: ['review', 'collaboration']
    },
    {
      title: 'Update documentation',
      completed: true,
      priority: 'low' as const,
      tags: ['documentation']
    }
  ];

  for (const todoData of moreTodos) {
    const response = await todos.create(todoData);
    const todo = response.data as TodoWithMeta;
    if (todo?.id) createdIds.push(todo.id);
    console.log(`✅ Created: "${todo?.title || 'Todo'}" (ID: ${todo?.id})`);
  }

  console.log(`\n📊 Created ${createdIds.length} todos total`);
  
  // Demonstrate validation
  console.log('\n🛡️  Testing Zod validation...');
  try {
    await todos.create({
      title: '', // Invalid - empty title
      priority: 'invalid' as any, // Invalid priority
      completed: false
    });
  } catch (error) {
    console.log('✅ Validation caught invalid data:', (error as Error).message);
  }
  
  return createdIds;
}

async function demonstrateReadOperations(client: RdbClient): Promise<void> {
  console.log('\n📖 READ Operations');
  console.log('------------------');

  const todos = client.tableWithSchema(TableNames.todos, TodoSchema);

  // Get all todos (with pagination)
  console.log('Fetching todos...');
  const todosResponse = await todos.list({ limit: 100 });
  const allTodos = todosResponse.data?.items || [];
  console.log(`� Found ${allTodos.length} todos total`);

  // Display some todos
  if (allTodos.length > 0) {
    console.log('\n📝 Sample todos:');
    allTodos.slice(0, 5).forEach((todo: TodoWithMeta, index: number) => {
      console.log(`   ${index + 1}. ${todo.title} (${todo.priority}) - ${todo.completed ? '✅' : '⏳'}`);
    });
  }

  // Note about limitations
  console.log('\nNote: Advanced filtering, searching, and sorting require additional API endpoints');
  console.log('The current SDK supports basic list operations with pagination');
}

async function demonstrateDeleteOperations(client: RdbClient): Promise<void> {
  console.log('\n🗑️  DELETE Operations');
  console.log('--------------------');

  const todos = client.tableWithSchema(TableNames.todos, TodoSchema);

  // Get some todos to delete
  const todosResponse = await todos.list({ limit: 5 });
  const todosList = todosResponse.data?.items || [];

  if (todosList.length > 0) {
    const todoToDelete = todosList[0] as TodoWithMeta;
    console.log(`Deleting todo: "${todoToDelete.title}"...`);
    
    try {
      await todos.delete(todoToDelete.id!);
      console.log('✅ Todo deleted successfully');
    } catch (error) {
      console.error('❌ Failed to delete todo:', error);
    }

    // Delete one more if available
    if (todosList.length > 1) {
      const secondTodo = todosList[1] as TodoWithMeta;
      console.log(`\nDeleting another todo: "${secondTodo.title}"...`);
      
      try {
        await todos.delete(secondTodo.id!);
        console.log('✅ Second todo deleted successfully');
      } catch (error) {
        console.error('❌ Failed to delete second todo:', error);
      }
    }
  } else {
    console.log('ℹ️  No todos available to delete');
  }

  // Show remaining count
  const remainingResponse = await todos.list({ limit: 100 });
  const remaining = remainingResponse.data?.items || [];
  console.log(`\n📊 Remaining todos: ${remaining.length}`);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 CRUD demo stopped by user');
  process.exit(0);
});

// Run the demo
if (require.main === module) {
  crudDemo().catch((error) => {
    console.error('❌ Fatal error in CRUD demo:', error);
    process.exit(1);
  });
}