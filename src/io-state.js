import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

let activeInputRender = null;
let processQuestionInterface = null;

export function getActiveInputRender() {
  return activeInputRender;
}

export function setActiveInputRender(fn) {
  activeInputRender = fn;
}

export function clearActiveInputRender() {
  activeInputRender = null;
}

export function getOrCreateQuestionInterface() {
  if (!processQuestionInterface) {
    processQuestionInterface = readline.createInterface({ input, output });
  }
  return processQuestionInterface;
}

export function closeProcessQuestionInterface() {
  if (processQuestionInterface) {
    processQuestionInterface.close();
    processQuestionInterface = null;
  }
}
