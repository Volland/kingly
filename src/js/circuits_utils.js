define(function (require) {
  var _ = require('lodash');
  var utils = require('utils');
  var Err = require('custom_errors');
  var constants = require('constants');
  var Rx = require('rx');

  return require_circuits_utils(Rx, _, utils, Err, constants);
});

function require_circuits_utils(Rx, _, utils, Err, constants) {
  /**
   * This only tests a serie of outputs vs. a serie of inputs linked in a 1-to-1 relationship, i.e. 1 input -> 1 output
   * Two signatures :
   * - output$ is an observable : will capture the stream of outputs
   * - is undefined : nothing. Outputs will be accumulated outside the test utility function, return an observable which just wait for some time to allow that process to finish
   * @param {{input_seq, inputS, max_delay, wait_for_finish_delay}} input_parameters
   * @param {{expected_output_seq, output$, output_transform_fn}} output_parameters
   * @param {String} [test_identifier]
   * @returns {Rx.Observable}
   */
  // TODO : adjust API to gather input params in one object, and output params in another one
  function rx_test_with_random_delay(input_parameters, output_parameters, test_identifier) {
    var input_seq = input_parameters.input_seq;
    var max_delay = input_parameters.max_delay;
    var wait_for_finish_delay = input_parameters.wait_for_finish_delay || 50;
    var inputS = input_parameters.inputS;
    var output$ = output_parameters.output$;
    var output_transform_fn = output_parameters.output_transform_fn;

    var test_initial_state = [];

    // Send the input sequence on the input connector with random time spacing (behaviour should be independent)
    // Hence no input value will be emitted in this tick, which allows the rest of the code on the same tick to wire other observables.
    var input$ = Rx.Observable.from(input_seq)
      .delay(utils.random(1, max_delay))
      .do(simulate_input(inputS))
      .share();
    input$.subscribe(log_test_input);

    // Returns an observable which only emits one value when the test has completed (successfully or not) : the test success
    // NOTE:  The test aborts as soon as a mismatch between expected output value and actual output value is detected
    /**
     * @type Rx.Observable <Boolean>
     */
    return output$
      ? output$
      .scan(function (transformed_actual_outputs, output_value) {
        var transformed_actual_output = output_transform_fn(output_value);
        transformed_actual_outputs.push(transformed_actual_output);

        return transformed_actual_outputs;
      }, test_initial_state)
      .sample(input$.last().delay(wait_for_finish_delay))// give it some time to process the inputs, after the inputs have been emitted
      .do(utils.rxlog('transformed_actual_outputs'))
      .take(1)
      : Rx.Observable.return({}).delay(max_delay * input_seq.length * 4)
      ;

  }

  // TODO : document, possibly fuse the previous into one with the new one
  function rx_test_seq_with_random_delay(input_parameters, output_parameters, test_identifier) {
    var input_seq = input_parameters.input_seq;
    var max_delay = input_parameters.max_delay;
    var wait_for_finish_delay = input_parameters.wait_for_finish_delay || 50;
    var input_conn_hash = input_parameters.input_conn_hash;
    var output$ = output_parameters.output$;
    var output_transform_fn = output_parameters.output_transform_fn;

    var test_initial_state = [];

    // Send the input sequence on the input connector with random time spacing (behaviour should be independent)
    // Hence no input value will be emitted in this tick, which allows the rest of the code on the same tick to wire other observables.
    var input$ = Rx.Observable.from(input_seq)
      .concatMap(function (input_obj) {
        return Rx.Observable.return(input_obj).delay(utils.random(1, max_delay))
      })
      //      .delay(utils.random(1, max_delay))
      .do(simulate_input_2(input_conn_hash))
      .share();
    input$.subscribe(log_test_input);

    // Returns an observable which only emits one value when the test has completed (successfully or not) : the test success
    // NOTE:  The test aborts as soon as a mismatch between expected output value and actual output value is detected
    /**
     * @type Rx.Observable <Boolean>
     */
    return output$
      ? output$
      .scan(function (transformed_actual_outputs, output_value) {
        var transformed_actual_output = output_transform_fn(output_value);
        transformed_actual_outputs.push(transformed_actual_output);

        return transformed_actual_outputs;
      }, test_initial_state)
      .sample(input$.last().delay(wait_for_finish_delay))// give it some time to process the inputs, after the inputs have been emitted
      .do(utils.rxlog('transformed_actual_outputs'))
      .take(1)
      : Rx.Observable.return({}).delay(max_delay * input_seq.length * 4)
      ;

  }

  //////
  // Helpers
  function simulate_input(inputS) {
    return function simulate_input(input_value) {
      inputS.onNext(input_value);
    }
  }

  function simulate_input_2(input_conn_hash) {
    return function simulate_input(input_obj) {
      input_conn_hash[input_obj.to].onNext(input_obj.input);
    }
  }

  function log_test_input(input_value) {
    console.info('test value emitted : ', input_value);
  }

  return {
    rx_test_with_random_delay: rx_test_with_random_delay,
    rx_test_seq_with_random_delay: rx_test_seq_with_random_delay
  }
}

