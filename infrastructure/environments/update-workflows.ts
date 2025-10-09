import { readdir } from 'fs/promises';
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { basename, join } from 'path';
import * as glob from 'glob';
import * as yaml from 'js-yaml';

interface WorkflowConfig {
  workflows: string[];
  path: string;
}

type EnvironmentType = 'production' | 'non-production';

interface EnvironmentInfo {
  name: string;
  type: EnvironmentType;
}

async function extractInfrastructureNames(): Promise<string[]> {
  const files = glob.sync('infrastructure/server-setup/inventory/*.yml');
  
  const infraEnvironments = files.map(file => basename(file, '.yml'));
  if (infraEnvironments.length === 0) {
    console.log('⚠️  Warning: No environment directories found in infrastructure/server-setup/inventory/');
    return [];
  }
  console.log('List of existing infrastructure configurations:');
  console.log(infraEnvironments.join(', '));
  
  return infraEnvironments;
}

async function extractEnvironmentNames(): Promise<string[]> {
  const entries = await readdir('environments');
  
  // Filter only directories
  const environments = entries.filter(entry => {
    const fullPath = join('environments', entry);
    return statSync(fullPath).isDirectory();
  });
  if (environments.length === 0) {
    console.log('⚠️  Warning: No environment directories found in environments/');
    return [];
  }

  console.log('\nList of existing environment configurations:');
  console.log(environments.join(', '));
  
  return environments;
}

function getEnvironmentType(envName: string): EnvironmentType {
  const valuesFilePath = join('environments', envName, 'opencrvs-services', 'values.yaml');
  
  if (!existsSync(valuesFilePath)) {
    console.log(`⚠️  Warning: values.yaml not found for ${envName}, defaulting to non-production`);
    return 'non-production';
  }
  
  try {
    const fileContents = readFileSync(valuesFilePath, 'utf8');
    const valuesData = yaml.load(fileContents) as any;
    
    const environmentType = valuesData?.environment_type;
    
    if (environmentType === 'production') {
      return 'production';
    } else {
      return 'non-production';
    }
  } catch (error) {
    console.log(`⚠️  Warning: Could not read environment_type for ${envName}, defaulting to non-production`);
    return 'non-production';
  }
}

function getWorkflowsForEnvironmentType(type: EnvironmentType): string[] {
  switch (type) {
    case 'production':
      return [
        '.github/workflows/deploy-dependencies-with-approval.yml',
        '.github/workflows/deploy-opencrvs-with-approval.yml',
        '.github/workflows/k8s-seed-data.yml'
      ];
    case 'non-production':
      return [
        '.github/workflows/deploy-dependencies.yml',
        '.github/workflows/deploy-opencrvs.yml',
        '.github/workflows/k8s-reset-data.yml',
        '.github/workflows/k8s-seed-data.yml'
      ];
  }
}

function updateOptionsInYaml(content: string, envList: string[]): string {
  // Find the options array pattern
  // Matches: options: followed by array items (- item)
  const optionsRegex = /([ ]*options:[ ]*\n)((?:[ ]*-[^\n]*\n)+)/;
  
  const match = content.match(optionsRegex);
  
  if (!match) {
    throw new Error('Could not find options array in workflow file');
  }
  
  // Get the indentation from the first array item
  const firstItemMatch = match[2].match(/^([ ]*)-/);
  const itemIndent = firstItemMatch ? firstItemMatch[1] : '          ';
  
  // Create new options array
  const newOptions = match[1] + envList.map(env => `${itemIndent}- ${env}`).join('\n') + '\n';
  
  // Replace the old options array with the new one
  return content.replace(optionsRegex, newOptions);
}

async function updateWorkflows(
  envList: string[],
  config: WorkflowConfig
): Promise<void> {
  const { workflows } = config;
  
  for (const workflowPath of workflows) {
    console.log(`\nUpdating ${workflowPath} with: [${envList.join(', ')}]`);
    
    try {
      const fileContents = readFileSync(workflowPath, 'utf8');
      
      // Verify the file is valid YAML and has the expected structure
      const workflowData = yaml.load(fileContents) as any;
      if (!workflowData?.on?.workflow_dispatch?.inputs?.environment?.options) {
        throw new Error('Workflow does not have the expected structure: on.workflow_dispatch.inputs.environment.options');
      }
      
      // Update only the options array while preserving everything else
      const updatedContent = updateOptionsInYaml(fileContents, envList);
      
      writeFileSync(workflowPath, updatedContent, 'utf8');
      console.log(`✓ Successfully updated ${workflowPath}`);
    } catch (error) {
      console.error(`✗ Failed to update ${workflowPath}:`, error);
      throw error;
    }
  }
}

export async function updateWorkflowEnvironments(): Promise<void> {
  try {
    console.log('🔄 Updating workflow environments...\n');
    
    // Extract infrastructure names
    const infraEnvironments = await extractInfrastructureNames();
    
    // Extract environment names (only directories)
    const environments = await extractEnvironmentNames();
    
    // Categorize environments by type
    console.log('\n🔍 Detecting environment types...');
    const environmentsByType: Record<EnvironmentType, string[]> = {
      'production': [],
      'non-production': []
    };
    
    for (const env of environments) {
      const type = getEnvironmentType(env);
      environmentsByType[type].push(env);
      console.log(`  ${env}: ${type}`);
    }
    
    console.log('\n📝 Updating workflows...');
    
    // Update workflows with infrastructure configurations
    await updateWorkflows(infraEnvironments, {
      workflows: ['.github/workflows/provision.yml'],
      path: 'on.workflow_dispatch.inputs.environment.options'
    });
    
    // Update workflows for each environment type
    for (const [type, envs] of Object.entries(environmentsByType) as [EnvironmentType, string[]][]) {
      if (envs.length === 0) {
        console.log(`\n⏭️  Skipping ${type} (no environments found)`);
        continue;
      }
      
      console.log(`\n📋 Updating ${type} workflows...`);
      const workflows = getWorkflowsForEnvironmentType(type);
      
      await updateWorkflows(envs, {
        workflows,
        path: 'on.workflow_dispatch.inputs.environment.options'
      });
    }
    
    console.log('\n✅ All workflows updated successfully!');
    console.log('\n💡 Review the changes and commit them when ready.');
    
  } catch (error) {
    console.error('\n❌ Error updating workflows:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  updateWorkflowEnvironments();
}
