define(function (require) {
  var utils = require('utils');
  var Err = require('custom_errors');
  var constants = require('constants');
  var circuits = require('circuits');
  var circuit_utils = require('circuits_utils');
  var rx_test_with_random_delay = circuit_utils.rx_test_with_random_delay;
  var get_chip_port = circuits.get_chip_port;
  var make_link = circuits.make_link;
  var get_port_uri = circuits.get_port_uri;
  var get_default_simulate_conn = circuits.get_default_simulate_conn;
  var get_default_readout_conn = circuits.get_default_readout_conn;
  var rxlog = utils.rxlog;

  // Constants
  var COMMAND_PLUG_IN_CIRCUIT = constants.COMMAND_PLUG_IN_CIRCUIT;
  var CIRCUIT_OR_CHIP_TYPE = constants.CIRCUIT_OR_CHIP_TYPE;
  var max_delay = 10;

  var IN_port_name = 'order$';
  var OUT_port_name = 'circuits_state$';
  var controller_setup = {
    uri: 'controller_1',
    ports: {
      IN: [IN_port_name],
      OUT: [OUT_port_name]
    }
  };
  var dummy_settings = {settings_key: 'settings_value'};

  function make_test_chip(index, IN, OUT, chip_transform_fn) {
    var chip_serie = 'test_chip_serie';
    var ports = {};
    ports.IN = IN;
    ports.OUT = OUT;
    var chip = {
      serie: chip_serie, uri: [chip_serie, '_', index + 1].join(''),
      ports: ports,
      transform: chip_transform_fn,
      settings: dummy_settings
    };

    return utils.set_custom_type(chip, CIRCUIT_OR_CHIP_TYPE);
  }

  function make_spyed_on_test_transform_fn(assert, transform_fn, post_transform_args_fn, expected_transformed_args, message) {
    return function make_test_transform_fn() {
      var actual_args = utils.args_to_array(arguments);
      if (!utils.is_function(post_transform_args_fn)) post_transform_args_fn = utils.identity;
      assert.deepEqual(post_transform_args_fn.apply(null, actual_args), expected_transformed_args, message);
      return transform_fn.apply(null, actual_args);
    }
  }

  function catch_error_test_results(e) {
    console.error('catch_error_test_results', e);
  }

  QUnit.skip("Controller - Plug-in command", function test_controller(assert) {
    var done = assert.async(1);

    var controller = circuits.create_controller(controller_setup);

    var simulate_conn = controller.test.simulate;
    var readout_conn = controller.test.readout;
    var controller_uri = controller.uri;
    var controller_port_uri = circuits.get_port_uri({chip_uri: controller_uri, port_name: IN_port_name});

    // Test scenario
    // 1. Controller processes chip's plug-in order
    // Test Message
    var test_success_message = [
      'The controller receives orders on its input port, processes those orders, and returns hashmaps for the input and output connectors of the updated (i.e. post-order) circuit.',    // TODO : some string here
      'The controller output can hence serve as a trace of the circuit\'s architectural evolution.',
      'As any chip/circuit, the controller has test connectors to send inputs and read outputs from outside the controller\'s scope.',
      'Inputs going through the `simulate` test connector must be prefixed with the port uri.',
      'Output values coming from the output ports are prefixed with the port uri and forwarded to the `readout` test connector.'
    ].join('\n');
    // Test Inputs
    var chip_transform_fn = function chip_transform_fn(test_in_port$) {
      return {
        test_out_port$: test_in_port$.map(function (x) {return {test_outed: x}})
      }
    };
    var chip_post_transformed_fn = function test_in_port$(source1$, settings) {
      return {
        args_number: 2,
        is_first_arg_observable: utils.has_type(source1$, 'Observable'),
        settings: settings
      }
    };
    var expected_chip_transformed_args = {
      "args_number": 2,
      "is_first_arg_observable": true,
      "settings": {
        "settings_key": "settings_value"
      }
    };
    var spyed_on_message = [
      'The `transform` property of the chip is called with a list of observables corresponding to its defined input ports, and as last parameter the chip\'s `settings` property.',
      'When a chip is plugged in, its output ports are computed immediately with the `transform` function. In the case of side-effectful transform functions (for instance chips who do not have output ports), those side-effects are hence performed immediately.',
    ].join('\n');
    var chip = utils.set_custom_type({
      serie: 'test_chip',
      uri: 'test_chip1',
      ports: {
        IN: ['test_in_port$'],
        OUT: ['test_out_port$']
      },
      transform: make_spyed_on_test_transform_fn(assert, chip_transform_fn, chip_post_transformed_fn,
        expected_chip_transformed_args, spyed_on_message),
      settings: dummy_settings
    }, CIRCUIT_OR_CHIP_TYPE);

    var labelled_input = {};
    labelled_input[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: chip, links: undefined}
    };
    var expected_output_seq = [{
      "has_only_one_key": true,
      "port_uri": "controller_1-|circuits_state$",
      "IN_connector_hash_keys": ["controller_1-|order$", "controller_1-|$simulate$", "test_chip1-|test_in_port$", "test_chip1-|$simulate$"],
      "OUT_connector_hash_keys": ["controller_1-|$readout$", "controller_1-|circuits_state$", "test_chip1-|$readout$", "test_chip1-|test_out_port$"]
    }];
    var output$ = readout_conn;
    var controller_output_transform_fn = function (output_value) {
      var readout = output_value['controller_1-|circuits_state$'].readout;
      var IN_connector_hash = readout.IN_connector_hash;
      var OUT_connector_hash = readout.OUT_connector_hash;

      return {
        has_only_one_key: output_value && Object.keys(output_value).length === 1,
        port_uri: output_value && Object.keys(output_value)[0],
        IN_connector_hash_keys: Object.keys(IN_connector_hash),
        OUT_connector_hash_keys: Object.keys(OUT_connector_hash),
        // Could test that all of the values associated to those keys are in fact connectors (subject) but won't
      };
    };

    var input_parameters = {input_seq: [labelled_input], max_delay: max_delay, inputS: simulate_conn};
    var output_parameters = {
      expected_output_seq: expected_output_seq,
      output$: output$,
      output_transform_fn: controller_output_transform_fn
    };

    var test_results$ = rx_test_with_random_delay(input_parameters, output_parameters);
    test_results$.subscribe(analyze_test_results, catch_error_test_results, utils.noop);

    function analyze_test_results(actual_output_seq) {
      assert.deepEqual(actual_output_seq, expected_output_seq, test_success_message);
      done();
    }

    function catch_error_test_results(e) {
      console.error('catch_error_test_results', e);
      done();
    }

  });

  QUnit.skip("Chip - transform", function test_chip_transform(assert) {
    var done = assert.async(2);
    var get_port_uri = circuits.get_port_uri;

    // Test scenario
    // 1. Chip processes its input according to `transform` function
    // WHEN chip with three inputs, two outputs, receives two inputs on each input port
    // THEN it produces the expected output as determined by `transform` function on each of the outputs port
    // Test Message
    var chip_message = [
      'When inputs are received on input ports, the corresponding outputs are generated on each port as specified with the `transform`\'s chip property.',
      'Simulate and readout chip connectors untested here.'
    ].join('\n');
    // Test Inputs
    var port_1_input_seq = [1, 2];
    var port_2_input_seq = ['A', 'B'];
    var port_3_input_seq = ['-', '+'];
    var inputs_number = 4; // 2+ 2 as we merge two sources in one
    function transform_actual_output(output_value) {
      return output_value;
    }

    // Expected port output values
    var expected_output_seq_1 = [{"first": 1}, {"first": 2}, {"first": "A"}, {"first": "B"}];
    var expected_output_seq_2 = [{"second": "A"}, {"second": "B"}, {"second": "-"}, {"second": "+"}];

    // Controller definition
    var controller = circuits.create_controller(controller_setup);
    var controller_port_uri = get_port_uri({chip_uri: controller.uri, port_name: IN_port_name});
    var simulate_conn = controller.test.simulate;

    // Misc. variables
    var IN_connector_hash = controller.settings.IN_connector_hash;
    var OUT_connector_hash = controller.settings.OUT_connector_hash;

    var chip_serie = 'test_chip';
    var uri = 'test_chip_1';
    var chip_IN_port_name = 'test_in_port';
    var chip_OUT_port_name = 'test_out_port';

    // Chip definition
    var chip_transform_fn = function chip_transform_fn(test_in_port_1$, test_in_port_2$, test_in_port_3$) {
      return {
        test_out_port_1$: Rx.Observable.merge(test_in_port_1$, test_in_port_2$)
          .map(function (x) {return {first: x}}),
        test_out_port_2$: Rx.Observable.merge(test_in_port_2$, test_in_port_3$)
          .map(function (x) {return {second: x}})
      }
    };
    var chip = utils.set_custom_type({
      serie: chip_serie, uri: uri,
      ports: {
        IN: [chip_IN_port_name + '_1$', chip_IN_port_name + '_2$', chip_IN_port_name + '_3$'],
        OUT: [chip_OUT_port_name + '_1$', chip_OUT_port_name + '_2$']
      },
      transform: chip_transform_fn,
      settings: dummy_settings
    }, CIRCUIT_OR_CHIP_TYPE);


    // Plug-in chip
    // NOTE: this is synchronous, so the chip will be plugged in already at exiting the function call
    var plug_in_order = {};
    plug_in_order[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: chip, links: undefined}
    };
    simulate_conn.onNext(plug_in_order);

    // Chip port connectors
    var chip_IN_port_1S = IN_connector_hash.get(get_port_uri({chip_uri: uri, port_name: chip_IN_port_name + '_1$'}));
    var chip_IN_port_2S = IN_connector_hash.get(get_port_uri({chip_uri: uri, port_name: chip_IN_port_name + '_2$'}));
    var chip_IN_port_3S = IN_connector_hash.get(get_port_uri({chip_uri: uri, port_name: chip_IN_port_name + '_3$'}));
    var chip_OUT_port_1$ = OUT_connector_hash.get(get_port_uri({chip_uri: uri, port_name: chip_OUT_port_name + '_1$'}));
    var chip_OUT_port_2$ = OUT_connector_hash.get(get_port_uri({chip_uri: uri, port_name: chip_OUT_port_name + '_2$'}));

    // Setup the analysis of the results on the output ports
    [chip_OUT_port_1$, chip_OUT_port_2$].forEach(function read_out_ports(out_port, port_index) {
      var indices = [0, 0];
      (function (port_index) {
        var expected_output_seq = [expected_output_seq_1, expected_output_seq_2][port_index];
        var index = indices[port_index];
        var transformed_actual_output_seq = [];
        out_port
          .do(utils.rxlog('outport ' + port_index))
          .map(function collect_port_output(output_value) {
            transformed_actual_output_seq.push(transform_actual_output(output_value));
            return (++index === inputs_number) ? transformed_actual_output_seq : false;
          })
          .filter(function is_finished(x) {return !!x;})
          .subscribe(function analyze_port_output(actual_output_seq) {
            assert.deepEqual(actual_output_seq, expected_output_seq, chip_message);
            done();
          }, catch_error_test_results, utils.noop)
        ;
      })(port_index);
    });

    // Send chip test inputs on input ports
    [port_1_input_seq, port_2_input_seq, port_3_input_seq].forEach(function send_to_port(input_seq, index) {
      var chip_IN_port = [chip_IN_port_1S, chip_IN_port_2S, chip_IN_port_3S][index];
      input_seq.forEach(function send_input(input_value) {
        chip_IN_port.onNext(input_value);
      });
    });

    function catch_error_test_results(e) {
      console.error('catch_error_test_results', e);
      done();
    }

  });

  QUnit.skip("Circuit - links (incl. ordering) - no ports, no port mappings", function test_circuit_links(assert) {
    var done = assert.async(1);
    var order_chip_plugin_check = [];
    var order_subscription_check = false;
    var data_flow_check = [];
    var output_testS = new Rx.ReplaySubject(1);
    var input_number = 2;

    // Chip definition
    var chip_intent = make_test_chip(0, [], ['intent-OUT$'], function chip_transform(settings) {
      order_chip_plugin_check.push('chip_intent');
      return {
        // This is made so that the first value will not be emitted as the view will not have switched off the filter variable
        // The subsequent input number values will be
        'intent-OUT$': Rx.Observable.return(0)
          .concat(Rx.Observable.interval(1).map(function (x) {return x + 1}))
          .filter(function () {
            return order_subscription_check
          })
          .do(utils.rxlog('interval'))
          .take(input_number)
      }
    });
    var chip_model = make_test_chip(1, ['intent-IN$'], ['model-OUT$'], function chip_transform(intent$, settings) {
      order_chip_plugin_check.push('chip_model');
      intent$.subscribe(function (x) {
        data_flow_check.push(x);
      });
      // NOTE : now we have two streams subscribing to intent$, this test also tests that there is no side-effects doing so
      // intent$ is a subject so there should not be any side-effects

      return {
        'model-OUT$': intent$.map(function (x) {return ['chip_model', x].join(' - ');})
          // perform a side-effect on which intent will depend to be valid
          .startWith(null)
      }
    });
    var chip_view = make_test_chip(2, ['model-IN$'], [], function chip_transform(model$, settings) {
      order_chip_plugin_check.push('chip_view');
      model$.subscribe(function (model) {
        order_subscription_check = order_subscription_check || model === null;
        data_flow_check.push(model);
        output_testS.onNext(model);
      });
      return undefined; // sink
    });

    // Circuit definition
    // Dataflow will depend on order of links (switching link order will fail the test)
    var links = [
      make_link(chip_intent, chip_model, 'intent-OUT$', 'intent-IN$'),
      make_link(chip_model, chip_view, 'model-OUT$', 'model-IN$')
    ];
    var circuit = utils.set_custom_type({
      uri: 'test_circuit_1',
      chips: [chip_model, chip_view, chip_intent],
      links: links
      // NOTE : no circuit_ports_map, no simulate as there is no input port for the circuit;
    }, CIRCUIT_OR_CHIP_TYPE);

    // Test scenario
    // 1. Plugged-in circuit processes its inputs according to defined chip architecture (chips and links) - no cycle
    // WHEN
    // |I )-> intent$ -> M )-> model$ -> V|
    // AND received two inputs on first chip input ports,
    // THEN it produces the expected output as determined by `transform` function on each of the outputs port
    // Test Message
    var chip_message = [
      'Inputs are transformed according to each chip `transform` function, and passed to output ports.',
      'According to the configured links, data flows to a subsequent input port and the process is repeated as long as there is a target input port.',
      'Links are connected in order of declaration, i.e. according to their index in the `links` array property of the links\' circuit.',
      'Hence different dataflows can be obtained according to the order of the link connection.',
      'Circuits need have neither input port, nor output port, nor port mappings.'
    ].join('\n');
    var chip_order_message = [
      'Chips are plugged in order of their definition in the circuit, i.e. according to their index in the circuit\'s `chips` array property.',
      'This however should not change the dataflow as chip are plugged connectionless.'
    ].join('\n');

    // There is no test input as there is no input port to the circuit

    // Expected port output values
    var expected_order = ["chip_model", "chip_view", "chip_intent"];
    var expected_data_flow = [null, 1, "chip_model - 1", 2, "chip_model - 2"];
    output_testS.take(input_number + 1).subscribe(utils.noop, catch_error_test_results, function completed() {
      assert.deepEqual(order_chip_plugin_check, expected_order, chip_order_message);
      assert.deepEqual(data_flow_check, expected_data_flow, chip_message);
      done();
    });

    // Controller definition
    var controller = circuits.create_controller(controller_setup);
    var controller_port_uri = get_port_uri({chip_uri: controller.uri, port_name: IN_port_name});
    var simulate_conn = controller.test.simulate;

    // Plug-in circuit
    // NOTE: this is synchronous, so the circuit will be plugged in already at exiting the function call
    var plug_in_order = {};
    plug_in_order[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: circuit} // no links
    };
    simulate_conn.onNext(plug_in_order);

    // Pluging-in the circuit should start the data flow
  });

  QUnit.skip("Circuit - links - ports and port mappings - one circuit connector IN and OUT", function test_circuit_links(assert) {
    var done = assert.async(1);

    // Chip definition
    var chip_A = make_test_chip(0, ['A-IN$'], ['A1-OUT$', 'A2-OUT$'], function chip_transform(a_in$, settings) {
      console.log('settings', settings);
      return {
        'A1-OUT$': a_in$.do(rxlog('A1-OUT$:')).map(function (x) {return [x, '->', 'A1-OUT'].join(' ');}),
        'A2-OUT$': a_in$.do(rxlog('A2-OUT$:')).map(function (x) {return [x, '->', 'A2-OUT'].join(' ');})
      }
    });
    var chip_B = make_test_chip(1, ['B-IN$'], ['B-OUT$'], function chip_transform(b_in$, settings) {
      console.log('settings', settings);
      return {
        'B-OUT$': b_in$.do(rxlog('B-OUT$:')).map(function (x) {return [x, '->', 'B-OUT'].join(' ');})
      }
    });
    var chip_C = make_test_chip(2, ['C1-IN$', 'C2-IN$'], ['C1-OUT$', 'C2-OUT$'], function chip_transform(c1_in$, c2_in$, settings) {
      console.log('settings', settings);
      return {
        'C1-OUT$': c1_in$.do(rxlog('C1-OUT$:')).map(function (x) {return [x, '->', 'C1-OUT'].join(' ');}),
        'C2-OUT$': c2_in$.do(rxlog('C2-OUT$:')).map(function (x) {return [x, '->', 'C2-OUT'].join(' ');})
      }
    });

    // Circuit definition
    // Dataflow will depend on order of links (switching link order will fail the test)
    var circuit_simulate_conn = get_default_simulate_conn();
    var circuit_readout_conn = get_default_readout_conn();

    var links = [
      make_link(chip_A, chip_B, 'A1-OUT$', 'B-IN$'),
      make_link(chip_A, chip_C, 'A2-OUT$', 'C2-IN$'),
      make_link(chip_B, chip_C, 'B-OUT$', 'C1-IN$')
    ];
    var circuit = utils.set_custom_type({
      uri: 'test_circuit_1',
      chips: [chip_A, chip_B, chip_C],
      links: links,
      ports_map: {
        IN: {'Circuit-IN$': {chip_uri: chip_A.uri, port_name: 'A-IN$'}},
        OUT: {'Circuit-OUT$': {chip_uri: chip_C.uri, port_name: 'C1-OUT$'}}
      },
      test: {
        simulate: circuit_simulate_conn,
        readout: circuit_readout_conn
      }
    }, CIRCUIT_OR_CHIP_TYPE);

    // Test scenario
    // 1. Plugged-in circuit processes its inputs according to defined chip architecture (chips and links)
    //    - no cycle
    //    - circuit with port mappings, and input port and output port
    // WHEN
    // ----A )-> B )-> C ----
    //       )->    -> C --
    // AND received two inputs on circuit input port,
    // THEN it produces the expected output
    // AND circuit output ports reads all readout messages from lower level chip/circuits
    // Test Message
    var test_success_message = [
      'Circuits can have input and output ports. Those input and output ports MUST be mapped respectively to a lower-level defined circuit/chip\'s input and output ports.',
      'The circuit simulate port sends all port-labelled (prefixed with port_uri from lower-level circuit/chips) down the hierarchy according to the IN ports mapping defined at circuit\'s level.',
      'However, the incoming message will be filtered out by ports whose uri do not correspond to the message label. Hence messages are only forwarded to the labelled port.',
      'The circuit readout port receive all readouts from lower-level circuit/chips which themselves receives all readout from their own lower-level chips. In the end, a circuit\'s readout receives all readouts from lower-level circuit/chips',
      'The circuit readout connectors are connected to lower-level chip/circuit\'s readout and receive their values. However, circuit readout values are relabelled to reflect the circuit OUT port.',
      'Chip\'s OUT Ports which are not subscribed to do not give rise to the corresponding dataflow (i.e. dataflow is lazy)'
    ].join('\n');

    // Test inputs
    var input_seq = [
      {'test_circuit_1-|Circuit-IN$': 0},
      {'test_circuit_1-|Circuit-IN$': 1}
    ];

    // Expected port output values
    // Note that there is no value about C2 as there is no corresponding flow (no subscribers!)
    // Note also that readout connectors are connected to each other, so all intermediary readout are also passed up
    // TODO : determine if this is the appropriate behaviour or not
    var expected_output_seq = [
      {"test_chip_serie_1-|A1-OUT$": "0 -> A1-OUT"},
      {"test_chip_serie_2-|B-OUT$": "0 -> A1-OUT -> B-OUT"},
      {"test_circuit_1-|Circuit-OUT$": "0 -> A1-OUT -> B-OUT -> C1-OUT"},
      {"test_chip_serie_1-|A2-OUT$": "0 -> A2-OUT"},
      {"test_chip_serie_1-|A1-OUT$": "1 -> A1-OUT"},
      {"test_chip_serie_2-|B-OUT$": "1 -> A1-OUT -> B-OUT"},
      {"test_circuit_1-|Circuit-OUT$": "1 -> A1-OUT -> B-OUT -> C1-OUT"},
      {"test_chip_serie_1-|A2-OUT$": "1 -> A2-OUT"}
    ];
    var output_transform_fn = function remove_time_stamp_from_readouts(labelled_readout) {
      return _.mapValues(labelled_readout, function (readout_struct) {
        return readout_struct.readout;
      });
    };
    var test_results$ = rx_test_with_random_delay({
      inputS: circuit_simulate_conn,
      max_delay: max_delay,
      wait_for_finish_delay: 20,
      input_seq: input_seq
    }, {
      output$: circuit_readout_conn,
      expected_output_seq: expected_output_seq,
      output_transform_fn: output_transform_fn
    });
    test_results$.subscribe(analyze_test_results, catch_error_test_results, rxlog('Test scenario completed'));

    function analyze_test_results(actual_output_seq) {
      assert.deepEqual(actual_output_seq, expected_output_seq, test_success_message);
      done();
    }

    // Controller definition
    var controller = circuits.create_controller(controller_setup);
    var controller_port_uri = get_port_uri({chip_uri: controller.uri, port_name: IN_port_name});
    var simulate_conn = controller.test.simulate;

    // Plug-in circuit
    // NOTE: this is synchronous, so the circuit will be plugged in already at exiting the function call
    var plug_in_order = {};
    plug_in_order[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: circuit} // no links
    };
    simulate_conn.onNext(plug_in_order);

    // Pluging-in the circuit should start the data flow
  });

  QUnit.skip("Circuit - links - ports and port mappings - one circuit connector IN and 2 OUT", function test_circuit_links(assert) {
    var done = assert.async(1);

    // Chip definition
    var chip_A = make_test_chip(0, ['A-IN$'], ['A1-OUT$', 'A2-OUT$'], function chip_transform(a_in$, settings) {
      console.log('settings', settings);
      return {
        'A1-OUT$': a_in$.do(rxlog('A1-OUT$:')).map(function (x) {return [x, '->', 'A1-OUT'].join(' ');}),
        'A2-OUT$': a_in$.do(rxlog('A2-OUT$:')).map(function (x) {return [x, '->', 'A2-OUT'].join(' ');})
      }
    });
    var chip_B = make_test_chip(1, ['B-IN$'], ['B-OUT$'], function chip_transform(b_in$, settings) {
      console.log('settings', settings);
      return {
        'B-OUT$': b_in$.do(rxlog('B-OUT$:')).map(function (x) {return [x, '->', 'B-OUT'].join(' ');})
      }
    });
    var chip_C = make_test_chip(2, ['C1-IN$', 'C2-IN$'], ['C1-OUT$', 'C2-OUT$'], function chip_transform(c1_in$, c2_in$, settings) {
      console.log('settings', settings);
      return {
        'C1-OUT$': c1_in$.do(rxlog('C1-OUT$:')).map(function (x) {return [x, '->', 'C1-OUT'].join(' ');}),
        'C2-OUT$': c2_in$.do(rxlog('C2-OUT$:')).map(function (x) {return [x, '->', 'C2-OUT'].join(' ');})
      }
    });

    // Circuit definition
    // Dataflow will depend on order of links (switching link order will fail the test)
    var circuit_simulate_conn = get_default_simulate_conn();
    var circuit_readout_conn = get_default_readout_conn();

    var links = [
      make_link(chip_A, chip_B, 'A1-OUT$', 'B-IN$'),
      make_link(chip_A, chip_C, 'A2-OUT$', 'C2-IN$'),
      make_link(chip_B, chip_C, 'B-OUT$', 'C1-IN$')
    ];
    var circuit = utils.set_custom_type({
      uri: 'test_circuit_1',
      chips: [chip_A, chip_B, chip_C],
      links: links,
      ports_map: {
        IN: {'Circuit-IN$': {chip_uri: chip_A.uri, port_name: 'A-IN$'}},
        OUT: {
          'Circuit1-OUT$': {chip_uri: chip_C.uri, port_name: 'C1-OUT$'},
          'Circuit2-OUT$': {chip_uri: chip_C.uri, port_name: 'C2-OUT$'}
        }
      },
      test: {
        simulate: circuit_simulate_conn,
        readout: circuit_readout_conn
      }
    }, CIRCUIT_OR_CHIP_TYPE);

    // Test scenario
    // 1. Plugged-in circuit processes its inputs according to defined chip architecture (chips and links)
    //    - no cycle
    //    - circuit with port mappings, and input port and output port
    // WHEN
    // ----A )-> B )-> C ----
    //       )->    -> C --
    // AND received two inputs on circuit input port,
    // THEN it produces the expected output
    // AND circuit output ports reads all readout messages from lower level chip/circuits
    // Test Message
    var test_success_message = [
      'Circuits can have any number of input and output ports.',
    ].join('\n');

    // Test inputs
    var input_seq = [
      {'test_circuit_1-|Circuit-IN$': 0},
      {'test_circuit_1-|Circuit-IN$': 1}
    ];

    // Expected port output values
    var expected_output_seq = [
      {"test_chip_serie_1-|A1-OUT$": "0 -> A1-OUT"},
      {"test_chip_serie_2-|B-OUT$": "0 -> A1-OUT -> B-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "0 -> A1-OUT -> B-OUT -> C1-OUT"},
      {"test_chip_serie_1-|A2-OUT$": "0 -> A2-OUT"},
      {"test_circuit_1-|Circuit2-OUT$": "0 -> A2-OUT -> C2-OUT"},
      {"test_chip_serie_1-|A1-OUT$": "1 -> A1-OUT"},
      {"test_chip_serie_2-|B-OUT$": "1 -> A1-OUT -> B-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "1 -> A1-OUT -> B-OUT -> C1-OUT"},
      {"test_chip_serie_1-|A2-OUT$": "1 -> A2-OUT"},
      {"test_circuit_1-|Circuit2-OUT$": "1 -> A2-OUT -> C2-OUT"}
    ];
    var output_transform_fn = function remove_time_stamp_from_readouts(labelled_readout) {
      return _.mapValues(labelled_readout, function (readout_struct) {
        return readout_struct.readout;
      });
    };
    var test_results$ = rx_test_with_random_delay({
      inputS: circuit_simulate_conn,
      max_delay: max_delay,
      wait_for_finish_delay: 20,
      input_seq: input_seq
    }, {
      output$: circuit_readout_conn,
      expected_output_seq: expected_output_seq,
      output_transform_fn: output_transform_fn
    });
    test_results$.subscribe(analyze_test_results, catch_error_test_results, rxlog('Test scenario completed'));

    function analyze_test_results(actual_output_seq) {
      assert.deepEqual(actual_output_seq, expected_output_seq, test_success_message);
      done();
    }

    // Controller definition
    var controller = circuits.create_controller(controller_setup);
    var controller_port_uri = get_port_uri({chip_uri: controller.uri, port_name: IN_port_name});
    var simulate_conn = controller.test.simulate;

    // Plug-in circuit
    // NOTE: this is synchronous, so the circuit will be plugged in already at exiting the function call
    var plug_in_order = {};
    plug_in_order[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: circuit} // no links
    };
    simulate_conn.onNext(plug_in_order);

    // Pluging-in the circuit should start the data flow
  });

  QUnit.test("Circuit - links - including cycles", function test_circuit_links(assert) {
    var done = assert.async(1);

    // Chip definition
    var chip_intent = make_test_chip(0, ['A-IN$'], ['Intent-OUT$'], function chip_transform(a_in$, settings) {
      console.log('settings', settings);
      return {
        'Intent-OUT$': a_in$.do(rxlog('Intent-OUT$:')).map(function (x) {return [x, '->', 'Intent-OUT'].join(' ');}),
      }
    });
    var chip_fsm = make_test_chip(1,
      ['Intent-IN$', 'PGI-IN$', 'Effect-Res-IN$'],
      ['PGI-OUT$', 'Effect-Req-OUT$', 'State-OUT$'],
      function chip_transform(intent_in$, pgi_in$, effect_res_in$, settings) {
        console.log('settings', settings);
        var counter = 0;
        return {
          'PGI-OUT$': intent_in$.do(rxlog('PGI-OUT$:'))
            .filter(function () {return counter % 3 === 0})
            .map(function (x) {return [x, '->', 'PGI-OUT'].join(' ');}),
          'Effect-Req-OUT$': intent_in$.do(rxlog('Effect-Req-OUT$:'))
            .filter(function () {return counter % 3 === 1})
            .map(function (x) {return [x, '->', 'Effect-Req-OUT'].join(' ');}),
          'State-OUT$': Rx.Observable.merge(intent_in$, pgi_in$, effect_res_in$)
            .do(rxlog('State-OUT$:'))
            .do(function () {counter++})
            .map(function (x) {return [x, '->', 'State-OUT'].join(' ');}),
        }
      });
    var chip_view = make_test_chip(2, ['State-IN$'], ['View-OUT$'], function chip_transform(state_in$, settings) {
      console.log('settings', settings);
      return {
        'View-OUT$': state_in$.do(rxlog('View-OUT$:')).map(function (x) {return [x, '->', 'View-OUT'].join(' ');}),
      };
    });

    // Circuit definition
    // Dataflow will depend on order of links (switching link order will fail the test)
    var circuit_simulate_conn = get_default_simulate_conn();
    var circuit_readout_conn = get_default_readout_conn();

    var links = [
      make_link(chip_fsm, chip_fsm, 'PGI-OUT$', 'PGI-IN$'),
      make_link(chip_fsm, chip_fsm, 'Effect-Req-OUT$', 'Effect-Res-IN$'),
      make_link(chip_fsm, chip_view, 'State-OUT$', 'State-IN$'),
      make_link(chip_intent, chip_fsm, 'Intent-OUT$', 'Intent-IN$'),
    ];
    var circuit = utils.set_custom_type({
      uri: 'test_circuit_1',
      chips: [chip_intent, chip_fsm, chip_view],
      links: links,
      ports_map: {
        IN: {'Circuit-IN$': {chip_uri: chip_intent.uri, port_name: 'A-IN$'}},
        OUT: {
          'Circuit1-OUT$': {chip_uri: chip_view.uri, port_name: 'View-OUT$'}
        }
      },
      test: {
        simulate: circuit_simulate_conn,
        readout: circuit_readout_conn
      }
    }, CIRCUIT_OR_CHIP_TYPE);

    // Test scenario
    // 1. Plugged-in circuit processes its inputs according to defined chip architecture (chips and links)
    //    - no cycle
    //    - circuit with port mappings, and input port and output port
    // WHEN
    // ----A )-> B )-> C ----
    //       )->    -> C --
    // AND received two inputs on circuit input port,
    // THEN it produces the expected output
    // AND circuit output ports reads all readout messages from lower level chip/circuits
    // Test Message
    var test_success_message = [
      'It is also possible to configure circuits having cycles. To that purpose, it is enough to connect an output port back to an input port.',
      'While there is no further trick, it is important to pay attention in cycles to both initialization (first value, order of execution), and avoiding infinite loops.'
    ].join('\n');

    // Test inputs
    var input_seq = [
      {'test_circuit_1-|Circuit-IN$': '-A-'},
      {'test_circuit_1-|Circuit-IN$': '-B-'}
    ];

    // Expected port output values
    var expected_output_seq = [
      {"test_chip_serie_1-|Intent-OUT$": "-A- -> Intent-OUT"},
      {"test_chip_serie_2-|PGI-OUT$": "-A- -> Intent-OUT -> PGI-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-A- -> Intent-OUT -> PGI-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-A- -> Intent-OUT -> PGI-OUT -> State-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-A- -> Intent-OUT -> Effect-Req-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|Effect-Req-OUT$": "-A- -> Intent-OUT -> Effect-Req-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-A- -> Intent-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-A- -> Intent-OUT -> Effect-Req-OUT -> State-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-A- -> Intent-OUT -> State-OUT"},
      {"test_chip_serie_1-|Intent-OUT$": "-B- -> Intent-OUT"},
      {"test_chip_serie_2-|PGI-OUT$": "-B- -> Intent-OUT -> PGI-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-B- -> Intent-OUT -> PGI-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-B- -> Intent-OUT -> PGI-OUT -> State-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-B- -> Intent-OUT -> Effect-Req-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|Effect-Req-OUT$": "-B- -> Intent-OUT -> Effect-Req-OUT"},
      {"test_circuit_1-|Circuit1-OUT$": "-B- -> Intent-OUT -> State-OUT -> View-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-B- -> Intent-OUT -> Effect-Req-OUT -> State-OUT"},
      {"test_chip_serie_2-|State-OUT$": "-B- -> Intent-OUT -> State-OUT"}
    ];
    var output_transform_fn = function remove_time_stamp_from_readouts(labelled_readout) {
      return _.mapValues(labelled_readout, function (readout_struct) {
        return readout_struct.readout;
      });
    };
    var test_results$ = rx_test_with_random_delay({
      inputS: circuit_simulate_conn,
      max_delay: max_delay,
      wait_for_finish_delay: 20,
      input_seq: input_seq
    }, {
      output$: circuit_readout_conn,
      expected_output_seq: expected_output_seq,
      output_transform_fn: output_transform_fn
    });
    test_results$.subscribe(analyze_test_results, catch_error_test_results, rxlog('Test scenario completed'));

    function analyze_test_results(actual_output_seq) {
      assert.deepEqual(actual_output_seq, expected_output_seq, test_success_message);
      done();
    }

    // Controller definition
    var controller = circuits.create_controller(controller_setup);
    var controller_port_uri = get_port_uri({chip_uri: controller.uri, port_name: IN_port_name});
    var simulate_conn = controller.test.simulate;

    // Plug-in circuit
    // NOTE: this is synchronous, so the circuit will be plugged in already at exiting the function call
    var plug_in_order = {};
    plug_in_order[controller_port_uri] = {
      command: COMMAND_PLUG_IN_CIRCUIT,
      parameters: {circuit: circuit} // no links
    };
    simulate_conn.onNext(plug_in_order);

    // Pluging-in the circuit should start the data flow
  });

});