import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface TestState {
  currentStep: number;
  completedSteps: string[];
  failedSteps: string[];
  startTime: string;
  lastRunTime: string;
  totalSteps: number;
  results: { [stepName: string]: any };
}

export interface TestStep {
  name: string;
  description: string;
  execute: () => Promise<any>;
  required?: boolean;
  skipOnFailure?: boolean;
}

export class ResumableTestRunner {
  private stateFile: string;
  private state: TestState;
  private steps: TestStep[];

  constructor(testName: string = 'default') {
    this.stateFile = join(process.cwd(), `.test-state-${testName}.json`);
    this.steps = [];
    this.state = this.loadState();
  }

  /**
   * Add a test step to the runner
   */
  addStep(step: TestStep): void {
    this.steps.push(step);
  }

  /**
   * Run all test steps, resuming from where we left off
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Resumable Test Runner');
    console.log('==================================');
    
    // Update total steps count
    this.state.totalSteps = this.steps.length;
    
    // Show current state
    this.showProgress();
    
    try {
      for (let i = this.state.currentStep; i < this.steps.length; i++) {
        const step = this.steps[i];
        
        console.log(`\n📋 Step ${i + 1}/${this.steps.length}: ${step.name}`);
        console.log(`   ${step.description}`);
        
        try {
          // Mark as current step
          this.state.currentStep = i;
          this.saveState();
          
          // Execute the step
          const startTime = Date.now();
          const result = await step.execute();
          const duration = Date.now() - startTime;
          
          // Mark as completed
          this.state.completedSteps.push(step.name);
          this.state.results[step.name] = {
            success: true,
            result,
            duration,
            timestamp: new Date().toISOString()
          };
          
          console.log(`   ✅ Completed in ${duration}ms`);
          
          // Remove from failed steps if it was previously failed
          const failedIndex = this.state.failedSteps.indexOf(step.name);
          if (failedIndex > -1) {
            this.state.failedSteps.splice(failedIndex, 1);
          }
          
        } catch (error) {
          const errorMessage = (error as Error).message;
          console.log(`   ❌ Failed: ${errorMessage}`);
          
          // Mark as failed
          if (!this.state.failedSteps.includes(step.name)) {
            this.state.failedSteps.push(step.name);
          }
          
          this.state.results[step.name] = {
            success: false,
            error: errorMessage,
            timestamp: new Date().toISOString()
          };
          
          // Check if it's an HTTP 4xx or 5xx error - always stop for these
          const isHttpError = /\b(4\d{2}|5\d{2})\b/.test(errorMessage) || 
                             errorMessage.toLowerCase().includes('forbidden') ||
                             errorMessage.toLowerCase().includes('unauthorized') ||
                             errorMessage.toLowerCase().includes('internal server error') ||
                             errorMessage.toLowerCase().includes('bad gateway') ||
                             errorMessage.toLowerCase().includes('service unavailable');
          
          if (isHttpError) {
            console.log(`   🚨 HTTP error detected - stopping execution immediately`);
            console.log(`   💡 Please check your API configuration and try again`);
            break;
          }
          
          // Stop execution if it's a required step and skipOnFailure is not set
          if (step.required !== false && !step.skipOnFailure) {
            console.log(`   🛑 Stopping execution - required step failed`);
            break;
          }
          
          console.log(`   ⏭️  Continuing to next step...`);
        }
        
        // Update state after each step
        this.state.lastRunTime = new Date().toISOString();
        this.saveState();
        
        // Add 5 second delay between steps (except after the last step)
        if (i < this.steps.length - 1) {
          console.log('   ⏱️  Waiting 5 seconds before next step...\n');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Mark as completed if we reached the end
      if (this.state.currentStep >= this.steps.length - 1) {
        this.state.currentStep = this.steps.length;
        console.log('\n🎉 All test steps completed!');
      }
      
    } finally {
      this.saveState();
      this.showFinalSummary();
    }
  }

  /**
   * Reset the test state
   */
  reset(): void {
    console.log('🔄 Resetting test state...');
    this.state = this.createInitialState();
    this.saveState();
    console.log('✅ Test state reset');
  }

  /**
   * Show current progress
   */
  private showProgress(): void {
    const completed = this.state.completedSteps.length;
    const failed = this.state.failedSteps.length;
    const total = this.state.totalSteps;
    
    console.log(`📊 Progress: ${completed}/${total} completed, ${failed} failed`);
    
    if (this.state.currentStep > 0) {
      console.log(`⏮️  Resuming from step ${this.state.currentStep + 1}`);
    }
    
    if (this.state.failedSteps.length > 0) {
      console.log(`❌ Previously failed steps: ${this.state.failedSteps.join(', ')}`);
    }
  }

  /**
   * Show final summary
   */
  private showFinalSummary(): void {
    console.log('\n📈 Test Summary');
    console.log('================');
    
    const completed = this.state.completedSteps.length;
    const failed = this.state.failedSteps.length;
    const total = this.state.totalSteps;
    
    console.log(`✅ Completed: ${completed}/${total}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📅 Started: ${this.state.startTime}`);
    console.log(`🕐 Last run: ${this.state.lastRunTime}`);
    
    if (completed === total && failed === 0) {
      console.log('\n🎉 All tests passed! You can run "npm run test:reset" to start over.');
    } else if (failed > 0) {
      console.log('\n🔄 Some tests failed. Run "npm run dev" again to retry failed steps.');
    }
  }

  /**
   * Load state from file
   */
  private loadState(): TestState {
    if (existsSync(this.stateFile)) {
      try {
        const content = readFileSync(this.stateFile, 'utf-8');
        const state = JSON.parse(content);
        console.log('📂 Loaded existing test state');
        return state;
      } catch (error) {
        console.log('⚠️  Failed to load test state, starting fresh');
        return this.createInitialState();
      }
    }
    
    console.log('🆕 Starting new test session');
    return this.createInitialState();
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.warn('⚠️  Failed to save test state:', error);
    }
  }

  /**
   * Create initial state
   */
  private createInitialState(): TestState {
    return {
      currentStep: 0,
      completedSteps: [],
      failedSteps: [],
      startTime: new Date().toISOString(),
      lastRunTime: new Date().toISOString(),
      totalSteps: 0,
      results: {}
    };
  }

  /**
   * Get current state (for inspection)
   */
  getState(): TestState {
    return { ...this.state };
  }

  /**
   * Check if a specific step was completed
   */
  isStepCompleted(stepName: string): boolean {
    return this.state.completedSteps.includes(stepName);
  }

  /**
   * Get result of a specific step
   */
  getStepResult(stepName: string): any {
    return this.state.results[stepName];
  }
}