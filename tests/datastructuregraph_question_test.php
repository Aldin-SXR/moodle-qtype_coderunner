<?php
// This file is part of CodeRunner - http://coderunner.org.nz/
//
// CodeRunner is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// CodeRunner is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with CodeRunner.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Tests for the data_structure_graph prototype grader template.
 *
 * @group qtype_coderunner
 *
 * @package    qtype
 * @subpackage coderunner
 * @copyright  2026
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace qtype_coderunner;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/question/type/coderunner/tests/test.php');

/**
 * @coversNothing
 */
class datastructuregraph_question_test extends \qtype_coderunner_testcase {

    /**
     * Return the shipped data_structure_graph prototype template.
     *
     * @return string
     */
    private function prototype_template(): string {
        global $CFG;
        $xml = simplexml_load_file($CFG->dirroot . '/question/type/coderunner/db/builtin_PROTOTYPES.xml');
        foreach ($xml->question as $question) {
            if ((string)$question->coderunnertype === 'data_structure_graph') {
                return (string)$question->template;
            }
        }
        $this->fail('data_structure_graph prototype not found');
    }

    /**
     * Make a question using the shipped prototype template.
     *
     * @param bool $allornothing whether exact 0/1 grading is enabled.
     * @return \qtype_coderunner_question
     */
    private function make_data_structure_question(
        bool $allornothing,
        ?string $answer = null,
        string $feedbackdetail = 'detailed',
        ?array $rubric = null
    ): \qtype_coderunner_question {
        $q = $this->make_question('sqrnoprint');
        $q->template = $this->prototype_template();
        $q->answer = $answer ?? $this->graph_json(true);
        $q->testcases = [];
        $q->iscombinatortemplate = true;
        $q->allornothing = $allornothing;
        $q->grader = 'TemplateGrader';
        $q->language = 'python3';
        $q->uiplugin = 'datastructuregraph';
        $q->uiparameters = '{"mode":"tree","isdirected":false}';
        $q->hoisttemplateparams = true;
        $q->parameters = ['feedbackdetail' => $feedbackdetail];
        if ($rubric !== null) {
            $q->parameters['rubric'] = $rubric;
        }
        return $q;
    }

    /**
     * Run the shipped Python grader template locally.
     *
     * This keeps the test focused on the prototype logic without requiring a
     * Jobe server to be available to the PHPUnit environment.
     *
     * @param string $studentanswer student graph serialisation.
     * @param bool $allornothing whether exact 0/1 grading is enabled.
     * @return array decoded template grader result.
     */
    private function run_data_structure_grader(
        string $studentanswer,
        bool $allornothing,
        ?string $correctanswer = null,
        string $feedbackdetail = 'detailed',
        ?array $rubric = null
    ): array {
        $q = $this->make_data_structure_question($allornothing, $correctanswer, $feedbackdetail, $rubric);
        $program = $q->twig_expand($q->template, [
            'STUDENT_ANSWER' => $studentanswer,
            'IS_PRECHECK' => '0',
            'TESTCASES' => [],
        ]);
        $output = $this->run_python_program($program);
        $result = json_decode($output, true);
        $this->assertIsArray($result, "Template did not return JSON. Output was:\n" . $output);
        return $result;
    }

    /**
     * Execute a Python program and return stdout.
     *
     * @param string $program Python source.
     * @return string stdout.
     */
    private function run_python_program(string $program): string {
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = proc_open('python3', $descriptors, $pipes);
        if (!is_resource($process)) {
            $this->markTestSkipped('python3 is not available to run the data_structure_graph grader template');
        }
        fwrite($pipes[0], $program);
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[2]);
        $exitcode = proc_close($process);

        $this->assertSame(0, $exitcode, "Python grader failed.\nSTDERR:\n$stderr\nProgram:\n$program");
        return $output;
    }

    /**
     * Return a sample answer serialisation.
     *
     * @param bool $complete true for the full tree, false to omit one edge.
     * @return string
     */
    private function graph_json(bool $complete): string {
        $edges = [
            ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => '', 'slot' => 'left'],
        ];
        if ($complete) {
            $edges[] = ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => 'right'];
        }
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => true, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 40]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 120]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 120]],
            ],
            'edges' => $edges,
        ]);
    }

    /**
     * Return a tree serialisation with blank edge slots, as older UI saves can contain.
     *
     * @return string
     */
    private function graph_json_without_slots(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => false, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 40]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 120]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 120]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => '', 'slot' => ''],
                ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => ''],
            ],
        ]);
    }

    /**
     * Return a tree serialisation whose edges were drawn child first.
     *
     * @return string
     */
    private function graph_json_child_first(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => false, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 40]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 120]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 120]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n2', 'to' => 'n1', 'cost' => '', 'slot' => 'right'],
                ['id' => 'e2', 'from' => 'n3', 'to' => 'n1', 'cost' => '', 'slot' => 'left'],
            ],
        ]);
    }

    /**
     * Return a tree serialisation with the first edge in the opposite order.
     *
     * @return string
     */
    private function graph_json_reversed_edge_order(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => false, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 100]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 100]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 100]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n2', 'to' => 'n1', 'cost' => '', 'color' => 'red', 'slot' => 'left'],
                ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => 'right'],
            ],
        ]);
    }

    /**
     * Return the matching tree with the first edge in canonical parent-child order.
     *
     * @return string
     */
    private function graph_json_canonical_edge_order(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => false, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 100]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 100]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 100]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => '', 'color' => 'red', 'slot' => 'left'],
                ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => 'right'],
            ],
        ]);
    }

    /**
     * Return the canonical tree with the first edge coloured black instead of red.
     *
     * @return string
     */
    private function graph_json_wrong_edge_color(): string {
        $graph = json_decode($this->graph_json_canonical_edge_order(), true);
        $graph['edges'][0]['color'] = 'black';
        return json_encode($graph);
    }

    /**
     * Return a B-tree style graph serialisation.
     *
     * @param bool $complete true for the full answer, false with one node value wrong.
     * @return string
     */
    private function btree_json(bool $complete): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => [
                'mode' => 'tree',
                'isdirected' => true,
                'childslots' => ['left', 'middle', 'right'],
                'nodefields' => 'keys_values',
                'maxnodekeys' => 3,
            ],
            'nodes' => [
                [
                    'id' => 'n1',
                    'key' => '10',
                    'value' => 'a',
                    'keys' => [
                        ['key' => '10', 'value' => 'a'],
                        ['key' => '20', 'value' => $complete ? 'b' : 'wrong'],
                    ],
                    'layout' => ['x' => 100, 'y' => 40],
                ],
                [
                    'id' => 'n2',
                    'key' => '5',
                    'value' => 'leaf',
                    'keys' => [['key' => '5', 'value' => 'leaf']],
                    'layout' => ['x' => 60, 'y' => 120],
                ],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'slot' => 'left'],
            ],
        ]);
    }

    /**
     * Return the B-tree serialisation without any edges.
     *
     * @return string
     */
    private function btree_json_without_edges(): string {
        $graph = json_decode($this->btree_json(true), true);
        $graph['edges'] = [];
        return json_encode($graph);
    }

    /**
     * Return a B-tree style graph in keys-only mode.
     *
     * @param string $secondvalue value stored beside the second key, which should be ignored.
     * @return string
     */
    private function btree_keys_only_json(string $secondvalue): string {
        $graph = json_decode($this->btree_json(true), true);
        $graph['settings']['nodefields'] = 'keys';
        $graph['nodes'][0]['keys'][1]['value'] = $secondvalue;
        return json_encode($graph);
    }

    /**
     * Return the sample tree with red-black node colours.
     *
     * @param bool $mismatch true to make one node colour wrong.
     * @return string
     */
    private function redblack_json(bool $mismatch): string {
        $graph = json_decode($this->graph_json(true), true);
        $graph['settings']['allownodecolors'] = true;
        $graph['nodes'][0]['color'] = 'black';
        $graph['nodes'][1]['color'] = 'red';
        $graph['nodes'][2]['color'] = $mismatch ? 'black' : 'red';
        return json_encode($graph);
    }

    /**
     * Return a weighted graph serialisation with controllable cost and node value.
     *
     * @param string $cost edge cost.
     * @param string $rootvalue value stored on node A.
     * @return string
     */
    private function weighted_graph_json(string $cost, string $rootvalue): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => [
                'mode' => 'graph',
                'isdirected' => false,
                'nodefields' => 'key_value',
                'allowedgecosts' => true,
            ],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => $rootvalue, 'layout' => ['x' => 80, 'y' => 80]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'node', 'layout' => ['x' => 180, 'y' => 80]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => $cost],
            ],
        ]);
    }

    /**
     * Return the sample tree with a changed value on node A.
     *
     * @param string $value replacement value.
     * @return string
     */
    private function graph_json_with_root_value(string $value): string {
        $graph = json_decode($this->graph_json(true), true);
        $graph['nodes'][0]['value'] = $value;
        return json_encode($graph);
    }

    /**
     * Return a valid tree with B as the root.
     *
     * @return string
     */
    private function graph_json_wrong_root(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => true, 'childslots' => ['left', 'right']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 120]],
                ['id' => 'n2', 'key' => 'B', 'value' => 'left', 'layout' => ['x' => 60, 'y' => 40]],
                ['id' => 'n3', 'key' => 'C', 'value' => 'right', 'layout' => ['x' => 140, 'y' => 200]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n2', 'to' => 'n1', 'cost' => '', 'slot' => 'left'],
                ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => 'right'],
            ],
        ]);
    }

    /**
     * Return the sample tree with an extra node.
     *
     * @return string
     */
    private function graph_json_extra_node(): string {
        $graph = json_decode($this->graph_json(true), true);
        $graph['nodes'][] = [
            'id' => 'n4',
            'key' => 'D',
            'value' => 'extra',
            'layout' => ['x' => 220, 'y' => 120],
        ];
        return json_encode($graph);
    }

    /**
     * Return the sample tree with node C and its edge removed.
     *
     * @return string
     */
    private function graph_json_missing_node(): string {
        $graph = json_decode($this->graph_json(true), true);
        array_pop($graph['nodes']);
        array_pop($graph['edges']);
        return json_encode($graph);
    }

    public function test_full_match_gets_full_marks(): void {
        $result = $this->run_data_structure_grader($this->graph_json(true), true);
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_all_or_nothing_incomplete_tree_gets_zero(): void {
        $result = $this->run_data_structure_grader($this->graph_json(false), true);
        $this->assertEquals(0.0, $result['fraction']);
    }

    public function test_partial_incomplete_tree_gets_partial_marks(): void {
        $result = $this->run_data_structure_grader($this->graph_json(false), false);
        $this->assertGreaterThan(0.0, $result['fraction']);
        $this->assertLessThan(1.0, $result['fraction']);
    }

    public function test_tree_edges_with_blank_slots_are_normalised(): void {
        $answer = $this->graph_json_without_slots();
        $result = $this->run_data_structure_grader($answer, true, $answer);
        $this->assertEquals(1.0, $result['fraction']);
    }

    /**
     * Return a tree with an arbitrary number of unlabelled children (childslots
     * disabled with ["none"]).
     *
     * @return string
     */
    private function tree_json_none_childslots(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'tree', 'isdirected' => true, 'childslots' => ['none']],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => 'root', 'layout' => ['x' => 100, 'y' => 40]],
                ['id' => 'n2', 'key' => 'B', 'value' => '', 'layout' => ['x' => 40, 'y' => 120]],
                ['id' => 'n3', 'key' => 'C', 'value' => '', 'layout' => ['x' => 100, 'y' => 120]],
                ['id' => 'n4', 'key' => 'D', 'value' => '', 'layout' => ['x' => 160, 'y' => 120]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => '', 'slot' => ''],
                ['id' => 'e2', 'from' => 'n1', 'to' => 'n3', 'cost' => '', 'slot' => ''],
                ['id' => 'e3', 'from' => 'n1', 'to' => 'n4', 'cost' => '', 'slot' => ''],
            ],
        ]);
    }

    public function test_tree_with_none_childslots_allows_arbitrary_children(): void {
        $answer = $this->tree_json_none_childslots();
        $result = $this->run_data_structure_grader($answer, true, $answer);
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_tree_with_none_childslots_scores_no_slot_category(): void {
        $answer = $this->tree_json_none_childslots();
        $result = $this->run_data_structure_grader($answer, false, $answer, 'detailed');
        // With slots disabled the child-slot category carries no weight, so a
        // missing child is still detected as a missing node/edge, not a slot error.
        $missing = json_decode($this->tree_json_none_childslots(), true);
        array_pop($missing['nodes']);
        array_pop($missing['edges']);
        $partial = $this->run_data_structure_grader(json_encode($missing), false, $answer);
        $this->assertGreaterThan(0.0, $partial['fraction']);
        $this->assertLessThan(1.0, $partial['fraction']);
    }

    /**
     * Return a directed graph that contains a self-loop on node A.
     *
     * @param bool $withloop whether to include the self-loop edge.
     * @return string
     */
    private function graph_json_self_loop(bool $withloop): string {
        $edges = [
            ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => ''],
        ];
        if ($withloop) {
            $edges[] = ['id' => 'e2', 'from' => 'n1', 'to' => 'n1', 'cost' => ''];
        }
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => ['mode' => 'graph', 'isdirected' => true],
            'nodes' => [
                ['id' => 'n1', 'key' => 'A', 'value' => '', 'layout' => ['x' => 80, 'y' => 80]],
                ['id' => 'n2', 'key' => 'B', 'value' => '', 'layout' => ['x' => 200, 'y' => 80]],
            ],
            'edges' => $edges,
        ]);
    }

    public function test_self_loop_edge_is_graded(): void {
        $answer = $this->graph_json_self_loop(true);
        $result = $this->run_data_structure_grader($answer, true, $answer);
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_missing_self_loop_edge_is_penalised(): void {
        $result = $this->run_data_structure_grader(
            $this->graph_json_self_loop(false),
            false,
            $this->graph_json_self_loop(true)
        );
        $this->assertLessThan(1.0, $result['fraction']);
    }

    public function test_tree_edges_drawn_child_first_are_normalised(): void {
        $result = $this->run_data_structure_grader($this->graph_json_child_first(), true, $this->graph_json(true));
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_undirected_tree_edges_ignore_endpoint_order_for_comparison(): void {
        $result = $this->run_data_structure_grader(
            $this->graph_json_reversed_edge_order(),
            true,
            $this->graph_json_canonical_edge_order()
        );
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_btree_full_match_gets_full_marks(): void {
        $answer = $this->btree_json(true);
        $result = $this->run_data_structure_grader($answer, true, $answer);
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_btree_partial_key_value_mismatch_gets_partial_marks(): void {
        $result = $this->run_data_structure_grader($this->btree_json(false), false, $this->btree_json(true));
        $this->assertGreaterThan(0.0, $result['fraction']);
        $this->assertLessThan(1.0, $result['fraction']);
    }

    public function test_btree_detailed_missing_edge_uses_full_node_labels(): void {
        $result = $this->run_data_structure_grader(
            $this->btree_json_without_edges(),
            true,
            $this->btree_json(true),
            'detailed'
        );
        $got = $result['testresults'][1][2];
        $this->assertStringContainsString('missing edge 10|20->5 (slot=left)', $got);
    }

    public function test_btree_keys_mode_ignores_values(): void {
        $result = $this->run_data_structure_grader(
            $this->btree_keys_only_json('student value'),
            true,
            $this->btree_keys_only_json('expected value')
        );
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_summary_feedback_hides_specific_missing_edge_details(): void {
        $result = $this->run_data_structure_grader(
            $this->graph_json(false),
            true,
            $this->graph_json(true),
            'summary'
        );
        $got = $result['testresults'][1][2];
        $this->assertSame(0.0, $result['fraction']);
        $this->assertStringContainsString('missing edge(s)', $got);
        $this->assertStringNotContainsString('A->C', $got);
        $this->assertStringNotContainsString('slot=right', $got);
    }

    public function test_minimal_feedback_hides_mismatch_categories(): void {
        $result = $this->run_data_structure_grader(
            $this->graph_json(false),
            true,
            $this->graph_json(true),
            'minimal'
        );
        $got = $result['testresults'][1][2];
        $this->assertSame('Structure differs from the expected answer.', $got);
        $this->assertStringNotContainsString('missing', $got);
        $this->assertStringNotContainsString('A->C', $got);
    }

    public function test_edge_color_mismatch_is_reported_as_color_issue(): void {
        $result = $this->run_data_structure_grader(
            $this->graph_json_wrong_edge_color(),
            true,
            $this->graph_json_canonical_edge_order(),
            'summary'
        );
        $got = $result['testresults'][1][2];
        $this->assertSame(0.0, $result['fraction']);
        $this->assertStringContainsString('1 wrong color(s)', $got);
        $this->assertStringNotContainsString('missing edge', $got);
        $this->assertStringNotContainsString('extra edge', $got);
    }

    public function test_no_rubric_keeps_legacy_behavior(): void {
        $result = $this->run_data_structure_grader($this->graph_json(false), true, $this->graph_json(true));
        $this->assertSame(0.0, $result['fraction']);
        $this->assertSame('All correct', $result['testresults'][2][1]);
    }

    public function test_preset_redblack_color_mismatch(): void {
        $legacy = $this->run_data_structure_grader(
            $this->redblack_json(true),
            false,
            $this->redblack_json(false)
        );
        $rubric = $this->run_data_structure_grader(
            $this->redblack_json(true),
            false,
            $this->redblack_json(false),
            'detailed',
            ['preset' => 'redblack']
        );
        $this->assertLessThan($legacy['fraction'], $rubric['fraction']);
        $this->assertStringContainsString('colors:', $rubric['testresults'][2][2]);
    }

    public function test_preset_weighted_graph_cost_mismatch(): void {
        $rubric = ['preset' => 'weighted_graph'];
        $valueonly = $this->run_data_structure_grader(
            $this->weighted_graph_json('5', 'student value'),
            false,
            $this->weighted_graph_json('5', 'expected value'),
            'detailed',
            $rubric
        );
        $costmismatch = $this->run_data_structure_grader(
            $this->weighted_graph_json('7', 'student value'),
            false,
            $this->weighted_graph_json('5', 'expected value'),
            'detailed',
            $rubric
        );
        $this->assertEquals(1.0, $valueonly['fraction']);
        $this->assertLessThan(1.0, $costmismatch['fraction']);
        $this->assertStringContainsString('edgecosts:', $costmismatch['testresults'][2][2]);
    }

    public function test_policy_ignore_skips_category(): void {
        $rubric = [
            'preset' => 'exact',
            'policies' => ['nodevalues' => 'ignore'],
            'weights' => ['nodes' => 50, 'nodevalues' => 50, 'edges' => 0, 'edgecosts' => 0, 'colors' => 0, 'childslots' => 0],
        ];
        $result = $this->run_data_structure_grader(
            $this->graph_json_with_root_value('student value'),
            false,
            $this->graph_json_with_root_value('expected value'),
            'detailed',
            $rubric
        );
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_cap_wrong_root_caps_score(): void {
        $rubric = [
            'weights' => ['nodes' => 100, 'nodevalues' => 0, 'edges' => 0, 'edgecosts' => 0, 'colors' => 0, 'childslots' => 0],
            'caps' => ['wrongRoot' => 70],
        ];
        $result = $this->run_data_structure_grader(
            $this->graph_json_wrong_root(),
            false,
            $this->graph_json(true),
            'detailed',
            $rubric
        );
        $this->assertLessThanOrEqual(0.7, $result['fraction']);
        $this->assertStringContainsString('score capped at 70%', $result['testresults'][1][2]);
    }

    public function test_missing_vs_extra_penalty_split(): void {
        $rubric = [
            'weights' => ['nodes' => 100, 'nodevalues' => 0, 'edges' => 0, 'edgecosts' => 0, 'colors' => 0, 'childslots' => 0],
            'penalties' => ['missingNodes' => 1.0, 'extraNodes' => 0.5],
        ];
        $missing = $this->run_data_structure_grader(
            $this->graph_json_missing_node(),
            false,
            $this->graph_json(true),
            'detailed',
            $rubric
        );
        $extra = $this->run_data_structure_grader(
            $this->graph_json_extra_node(),
            false,
            $this->graph_json(true),
            'detailed',
            $rubric
        );
        $this->assertGreaterThan($missing['fraction'], $extra['fraction']);
    }

    /**
     * Return a linked-list, stack or queue serialisation.
     *
     * @param string $mode 'list', 'stack' or 'queue'.
     * @param array $keys element keys in order (head/top/front first).
     * @param array|null $links list links as [fromindex, toindex, slot]; null for a correct chain.
     * @param string $listkind 'singly' or 'doubly'.
     * @return string
     */
    private function linear_json(string $mode, array $keys, ?array $links = null, string $listkind = 'singly'): string {
        $nodes = [];
        foreach ($keys as $index => $key) {
            $nodes[] = ['id' => 'n' . ($index + 1), 'key' => $key, 'layout' => ['x' => 100 * $index, 'y' => 100]];
        }
        if ($links === null) {
            $links = [];
            for ($i = 0; $i < count($keys) - 1; $i++) {
                $links[] = [$i, $i + 1, 'next'];
                if ($listkind === 'doubly') {
                    $links[] = [$i + 1, $i, 'prev'];
                }
            }
        }
        $edges = [];
        if ($mode === 'list') {
            foreach ($links as $index => [$from, $to, $slot]) {
                $edges[] = ['id' => 'e' . ($index + 1), 'from' => 'n' . ($from + 1), 'to' => 'n' . ($to + 1), 'slot' => $slot];
            }
        }
        $settings = ['mode' => $mode, 'nodefields' => 'key'];
        if ($mode === 'list') {
            $settings['listkind'] = $listkind;
        }
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => $settings,
            'nodes' => $nodes,
            'edges' => $edges,
        ]);
    }

    public function test_linked_list_with_duplicate_keys_gets_full_marks(): void {
        $correct = $this->linear_json('list', ['1', '1', '2']);
        $result = $this->run_data_structure_grader($this->linear_json('list', ['1', '1', '2']), true, $correct);
        $this->assertEquals(1.0, $result['fraction']);
        $this->assertEquals('Correct linked list', $result['testresults'][1][1]);
    }

    public function test_linked_list_wrong_order_is_reported_by_position(): void {
        $correct = $this->linear_json('list', ['1', '1', '2']);
        $result = $this->run_data_structure_grader($this->linear_json('list', ['1', '2', '1']), false, $correct);
        $this->assertGreaterThan(0.0, $result['fraction']);
        $this->assertLessThan(1.0, $result['fraction']);
        $this->assertStringContainsString("position 2 is '2', expected '1'", $result['testresults'][1][2]);
        $this->assertStringContainsString("missing link '1'->'1' (next)", $result['testresults'][1][2]);
    }

    public function test_linked_list_order_follows_links_not_node_order(): void {
        $correct = $this->linear_json('list', ['a', 'b', 'c']);
        // Nodes stored c, a, b but linked a -> b -> c.
        $student = $this->linear_json('list', ['c', 'a', 'b'], [[1, 2, 'next'], [2, 0, 'next']]);
        $result = $this->run_data_structure_grader($student, true, $correct);
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_linked_list_missing_tail_is_penalised_more_than_extra_tail(): void {
        $correct = $this->linear_json('list', ['1', '2', '3']);
        $missing = $this->run_data_structure_grader($this->linear_json('list', ['1', '2']), false, $correct);
        $extra = $this->run_data_structure_grader($this->linear_json('list', ['1', '2', '3', '4']), false, $correct);
        $this->assertStringContainsString("missing element '3' at position 3 (tail)", $missing['testresults'][1][2]);
        $this->assertStringContainsString("extra element '4' at position 4 (tail)", $extra['testresults'][1][2]);
        $this->assertGreaterThan($missing['fraction'], $extra['fraction']);
    }

    public function test_linked_list_cycle_and_forest_are_reported_without_crashing(): void {
        $correct = $this->linear_json('list', ['1', '2', '3']);
        $cycle = $this->run_data_structure_grader(
            $this->linear_json('list', ['1', '2', '3'], [[0, 1, 'next'], [1, 2, 'next'], [2, 0, 'next']]),
            false,
            $correct
        );
        $this->assertStringContainsString('linked list contains a cycle', $cycle['testresults'][1][2]);
        $this->assertLessThan(1.0, $cycle['fraction']);

        $forest = $this->run_data_structure_grader(
            $this->linear_json('list', ['1', '2', '3'], [[0, 1, 'next']]),
            false,
            $correct
        );
        $this->assertStringContainsString('must have exactly one head', $forest['testresults'][1][2]);
        $this->assertStringContainsString('not reachable from the head', $forest['testresults'][1][2]);
    }

    public function test_doubly_linked_list_checks_prev_links(): void {
        $correct = $this->linear_json('list', ['a', 'b', 'c'], null, 'doubly');
        $exact = $this->run_data_structure_grader($this->linear_json('list', ['a', 'b', 'c'], null, 'doubly'), true, $correct);
        $this->assertEquals(1.0, $exact['fraction']);

        $missingprev = $this->linear_json('list', ['a', 'b', 'c'], [[0, 1, 'next'], [1, 2, 'next'], [1, 0, 'prev']], 'doubly');
        $result = $this->run_data_structure_grader($missingprev, false, $correct);
        $this->assertStringContainsString("missing link 'c'->'b' (prev)", $result['testresults'][1][2]);
        $this->assertLessThan(1.0, $result['fraction']);
    }

    public function test_stack_is_compared_from_the_top(): void {
        $correct = $this->linear_json('stack', ['3', '2', '1']);
        $exact = $this->run_data_structure_grader($this->linear_json('stack', ['3', '2', '1']), true, $correct);
        $this->assertEquals(1.0, $exact['fraction']);
        $this->assertEquals('Correct stack', $exact['testresults'][1][1]);

        $reversed = $this->run_data_structure_grader($this->linear_json('stack', ['1', '2', '3']), true, $correct);
        $this->assertEquals(0.0, $reversed['fraction']);
        $this->assertStringContainsString("position 1 (top) is '1', expected '3'", $reversed['testresults'][1][2]);
    }

    public function test_queue_extra_element_at_rear(): void {
        $correct = $this->linear_json('queue', ['x', 'y']);
        $result = $this->run_data_structure_grader($this->linear_json('queue', ['x', 'y', 'z']), false, $correct);
        $this->assertStringContainsString("extra element 'z' at position 3 (tail)", $result['testresults'][1][2]);
        $this->assertStringContainsString('queue has 3 element(s), expected 2', $result['testresults'][1][2]);
        $this->assertGreaterThan(0.0, $result['fraction']);
    }

    public function test_queue_summary_feedback_uses_element_categories(): void {
        $correct = $this->linear_json('queue', ['x', 'y', 'z']);
        $result = $this->run_data_structure_grader($this->linear_json('queue', ['x', 'z', 'y']), false, $correct, 'summary');
        $this->assertEquals('2 element mismatch(es)', $result['testresults'][1][2]);
    }

    public function test_sequence_rubric_preset_scores_positions(): void {
        $correct = $this->linear_json('stack', ['3', '2', '1']);
        $result = $this->run_data_structure_grader(
            $this->linear_json('stack', ['3', '1', '2']),
            false,
            $correct,
            'detailed',
            ['preset' => 'sequence']
        );
        // Nodes 3/3 (weight 30) and positions 1/3 (weight 70).
        $this->assertEqualsWithDelta((30 + 70 / 3) / 100, $result['fraction'], 0.001);
        $this->assertStringNotContainsString('link', $result['testresults'][1][2]);
    }

    public function test_linked_list_rubric_caps_wrong_head_and_cycle(): void {
        $rubric = ['preset' => 'linked_list', 'caps' => ['wrongHead' => 50, 'cycleInList' => 40]];
        // Only the head is wrong, so the uncapped score is well above 50%.
        $wronghead = $this->run_data_structure_grader(
            $this->linear_json('list', ['9', '2', '3', '4', '5', '6']),
            false,
            $this->linear_json('list', ['1', '2', '3', '4', '5', '6']),
            'detailed',
            $rubric
        );
        $this->assertEqualsWithDelta(0.5, $wronghead['fraction'], 0.0001);
        $this->assertStringContainsString("head is '9', expected '1'; score capped at 50%", $wronghead['testresults'][1][2]);

        $correct = $this->linear_json('list', ['1', '2', '3']);

        $cycle = $this->run_data_structure_grader(
            $this->linear_json('list', ['1', '2', '3'], [[0, 1, 'next'], [1, 2, 'next'], [2, 0, 'next']]),
            false,
            $correct,
            'detailed',
            $rubric
        );
        $this->assertLessThanOrEqual(0.4, $cycle['fraction']);
        $this->assertStringContainsString('score capped at 40%', $cycle['testresults'][1][2]);
    }

    public function test_linear_modes_grade_keys_only(): void {
        // Values sneaked into the serialisation (or left over from an older
        // key_value question) are ignored: elements hold a single key.
        $correct = json_decode($this->linear_json('queue', ['x', 'y']), true);
        $correct['settings']['nodefields'] = 'key_value';
        $correct['nodes'][0]['value'] = 'one';
        $student = json_decode($this->linear_json('queue', ['x', 'y']), true);
        $student['nodes'][0]['value'] = 'different';
        $result = $this->run_data_structure_grader(json_encode($student), true, json_encode($correct));
        $this->assertEquals(1.0, $result['fraction']);
    }
}
