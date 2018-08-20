// import {depthFirstTraverseGraphEdges} from 'graph-adt'
import { depthFirstTraverseGraphEdges } from '../../graph-adt/src'
import { INIT_STATE } from "./properties"
import { lastOf } from "./helpers"

function generateTestsFromFSM(fsm, generators, settings) {
  const fsmSettings = {
    subject_factory,
    merge,
    else?
  }; // TODO : pass the fsmSettings in settings? or should it be with the fsmDef (refactor?)
  const tracedFSM = traceFSM(fsm);
  // associate a gen to from, event, guard index = the transition it is mapped
  // DOC : contract, all transition for a (from, event) must be gathered in one place
  const genMap = getGeneratorMapFromGeneratorMachine(generators);
  const { search } = settings;

  // TODO
  // build a graph from the tracedFSM
  const fsmGraph = convertFSMtoGraph(tracedFSM);
  // search that graph with the right parameters
  const startingEdge = makeFakeEdge(INIT_STATE);
  // TODO : mapOverActions(env, FSM_Def, fmap). This conserves the structure and applies a function only to the
  // actions
  // this can be used for entry and exit actions implementation, and the fmap can be a decorating function. See if
  // possible to reuse existing decorating utils (paste them into helpers).
  // fmap should have access to the whole fsm_def :: FSM_Def -> Env -> Action -> Action
  const visit = {
    // TODO : initialEdgesPathState = { inputSequence: [], noMoreInputs: false } to put in client function
    initialEdgesPathState: { path: [], inputSequence: [], outputSequence: [], noMoreInput: false, tracedFSM: void 0 },
    // TODO : should compute inputSequence from gen, and fill noMoreInputs
    visitEdge: (edge, graph, pathTraversalState, graphTraversalState) => {
      let noMoreInput = false;
      let newInputSequence;
      let newOutputSequence;
      // NOTE : edge is a transition of the state machine
      const { path, inputSequence, outputSequence} = pathTraversalState;
      // Execute the state machine with the input sequence to get it in the matching control state
      const fsm = create_state_machine(tracedFSM, fsmSettings);
      const tracedOutputSequence = inputSequence.map(fsm.yield);
      const {controlState, extendedState} = lastOf(tracedOutputSequence);
      const transition = getGeneratorMappedTransitionFromEdge(edge);
      const gen = genMap(controlState, transition);
      const {input : newInput, hasGeneratedInput }= gen(extendedState);
      if (!hasGeneratedInput) {
        noMoreInput = true;
        newInputSequence = inputSequence;
        newOutputSequence = outputSequence;
      }
      else {
        newInputSequence = inputSequence.concat(newInput);
        const newOutput = fsm.yield(newInput);
        newOutputSequence = outputSequence.concat(newOutput);
        noMoreInput = false;
      }
      // That gives us control state, and extended state
      // Then get the generator matching the control state, and the edge transition
      // Run this generator with the extended state to see if therer is results
      // if there is no results then `noMoreInputs : true`
      // else add to inputSequence the input generated by the generator
      // and add to outputSequence the output generated by the machine fed that input

      return {
        pathTraversalState: {
          path: path.concat([edge]),
          inputSequence : newInputSequence,
          outputSequence: newOutputSequence,
          noMoreInput
        },
        isTraversableEdge: !noMoreInput
      }
    }
  };
  const testCases = depthFirstTraverseGraphEdges(search, visit, startingEdge, fsmGraph);

  return testCases
}

/**
 * given a FSM F, instrument that FSM to output in addition to its usual actions also its control
 state, extended state, -and an array of its transitions-NO-, to keep referential equality, take
 directly the reference of guards.forEach : it should have a to, predicate, action.
 */
function traceFSM() {
  // TODO
}

// - GenMap of generator get :: ControlState -> Transition -> EventGenerator TODO
function getGeneratorMapFromGeneratorMachine(generators) {
  // TODO
}


// API
// generateTestsFromFSM(fsm, generators, settings) : Array<TestCase>
// fsm :: FSM_Def
// generators :: FSM_Gen_Def
// settings :: *
// TestCase :: {input :: InputSequence, actual :: OutputSequence}
//
// A. FSM_Gen_Def
/**
 * @typedef {Object} FSM_Gen_Def
 * @property {Array<GenTransition>} generators An array of transitions associated to an input generator for the sut
 */
/**
 * @typedef {Object} GenTransition
 * @property {Array<GenTransitionFromState>} An array of transitions from a specific origin control state, including
 * input generators
 */
/**
 * @typedef {{from: ControlState, event: Event, guards: Array<GenSpecs>}} GenTransitionFromState Transition for the
 * specified state is contingent to some guards being passed. Those guards are defined as an array.
 */
/**
 * @typedef {{predicate: Predicate, gen: InputGenerator, to: ControlState}} GenSpecs Specifies a generator `gen`
 * which will be responsible for computing inputs which pass the predicate, triggering a transition to `to` control
 * state.
 */
/**
 * @typedef {function (ExtendedState) : LabelledEvent | NoInput} InputGenerator generator which knows how to generate an
 * input, taking into account the extended state of the machine under test, after an input sequence has been run on
 * it. The generated input is generated so as to trigger a specific transition of the state machine. In the event,
 * it is not possible to generate the targeted transition of the state machine, the generator returns a value of
 * type `NoInput`.
 */
/**
 * @typedef {*} NoInput any object which unequivocally signifies an absence of input.
 */
/**
 * @typedef {{input :: InputSequence, actual :: OutputSequence}} TestCase
 */
/**
 * @typedef {Array<LabelledEvent>} InputSequence
 */
/**
 * @typedef {Array<MachineOutput>} OutputSequence
 */