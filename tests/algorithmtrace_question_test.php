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
 * Tests for the algorithm_trace prototype grader and the AlgorithmTrace UI.
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
class algorithmtrace_question_test extends \qtype_coderunner_testcase {

    /** @var string The answer serialisation type. */
    const TYPE = 'coderunner-algorithm-trace';

    /** @var array The settings that are template parameters rather than UI parameters. */
    const TEMPLATE_SETTINGS = ['feedbackdetail', 'showmodelanswer', 'cellcredit', 'omitunchanged', 'stepmatching'];

    /**
     * Set up without requiring a Jobe sandbox: the grader runs on a local
     * python3 when there is one, else on the configured sandbox.
     */
    protected function setUp(): void {
        \advanced_testcase::setUp();
        $this->resetAfterTest(true);
        $this->setAdminUser();
        ob_start();
        if (\qtype_coderunner_util::using_mod_qbank()) {
            update_question_types_with_qbank();
        } else {
            update_question_types_legacy();
        }
        ob_end_clean();
        $generator = $this->getDataGenerator()->get_plugin_generator('core_question');
        $this->category = $generator->create_question_category([]);
    }

    /**
     * Whether an executable is on the PATH.
     *
     * @param string $command The command name.
     * @return bool
     */
    private static function available(string $command): bool {
        static $found = [];
        if (!isset($found[$command])) {
            $found[$command] = false;
            if (function_exists('exec') && function_exists('proc_open')) {
                $output = [];
                $status = 1;
                exec('command -v ' . escapeshellarg($command) . ' 2>/dev/null', $output, $status);
                $found[$command] = $status === 0 && !empty($output);
            }
        }
        return $found[$command];
    }

    /**
     * Return a field of the shipped algorithm_trace prototype.
     *
     * @param string $field The field name.
     * @return string
     */
    private function prototype_field(string $field): string {
        global $CFG;
        $xml = simplexml_load_file($CFG->dirroot . '/question/type/coderunner/db/builtin_PROTOTYPES.xml');
        foreach ($xml->question as $question) {
            if ((string)$question->coderunnertype === 'algorithm_trace') {
                return (string)$question->$field;
            }
        }
        $this->fail('algorithm_trace prototype not found');
    }

    /**
     * The Python library and grader inside the prototype template, without the Twig parts.
     *
     * @return string
     */
    private function python_library(): string {
        $template = $this->prototype_field('template');
        $start = strpos($template, '{% verbatim %}') + strlen('{% verbatim %}');
        $end = strpos($template, '{% endverbatim %}');
        return substr($template, $start, $end - $start);
    }

    /**
     * Run a Python program and return stdout.
     *
     * @param string $program Python source.
     * @param string|null $cwd Working directory, for support files.
     * @return string
     */
    private function run_python(string $program, ?string $cwd = null): string {
        if (!self::available('python3')) {
            if ($cwd !== null) {
                $this->markTestSkipped('This test needs a local python3');
            }
            self::setup_test_sandbox_configuration();
            $sandbox = \qtype_coderunner_sandbox::get_best_sandbox('python3');
            if ($sandbox === null) {
                $this->markTestSkipped('Neither a local python3 nor a python3 sandbox is available');
            }
            $run = $sandbox->execute($program, 'python3', '');
            $this->assertEquals(\qtype_coderunner_sandbox::RESULT_SUCCESS, $run->result, $run->stderr ?? '');
            return $run->output;
        }
        $pipes = [];
        $process = proc_open('python3', [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $cwd);
        fwrite($pipes[0], $program);
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $this->assertSame(0, proc_close($process), "Python failed.\nSTDERR:\n$stderr");
        return $output;
    }

    /**
     * Make a question that uses the shipped template.
     *
     * @param array $uiparams The question's UI parameters.
     * @param bool $allornothing All-or-nothing grading.
     * @return \qtype_coderunner_question
     */
    private function make_trace_question(array $uiparams, bool $allornothing = false): \qtype_coderunner_question {
        $q = $this->make_question('sqrnoprint');
        $q->coderunnertype = 'algorithm_trace';
        $q->template = $this->prototype_field('template');
        $q->answer = '';
        $q->testcases = [];
        $q->iscombinatortemplate = true;
        $q->allornothing = $allornothing;
        $q->grader = 'TemplateGrader';
        $q->language = 'python3';
        $q->uiplugin = 'algorithmtrace';
        $q->uiparameters = json_encode($uiparams);
        // As at run time, when the template sees the merged UI parameters.
        $q->mergeduiparameters = $uiparams;
        return $q;
    }

    /**
     * Grade a student answer with the shipped template.
     *
     * @param array $uiparams The question's UI parameters.
     * @param string $answer The serialised answer.
     * @param bool $allornothing All-or-nothing grading.
     * @param string|null $cwd Working directory, for support files.
     * @return array The decoded grader result.
     */
    private function grade(array $uiparams, string $answer, bool $allornothing = false, ?string $cwd = null): array {
        // The grading settings are template parameters; everything else is a UI parameter.
        $templateparams = array_intersect_key($uiparams, array_flip(self::TEMPLATE_SETTINGS));
        $uiparams = array_diff_key($uiparams, $templateparams);
        $q = $this->make_trace_question($uiparams, $allornothing);
        $q->parameters = (object)$templateparams;
        $program = $q->twig_expand($q->template, ['STUDENT_ANSWER' => $answer, 'IS_PRECHECK' => '0', 'TESTCASES' => []]);
        $output = $this->run_python($program, $cwd);
        $result = json_decode($output, true);
        $this->assertIsArray($result, "Grader output was not JSON:\n" . $output);
        return $result;
    }

    /**
     * Serialise steps as the UI does.
     *
     * @param array $steps Each a map of component name to value.
     * @return string
     */
    private function answer(array $steps): string {
        $steps = array_map(function ($step) {
            return array_map(function ($value) {
                return is_array($value) ? array_map(fn($cell) => $cell === null ? '' : (string)$cell, $value) : $value;
            }, $step);
        }, $steps);
        return json_encode(['type' => self::TYPE, 'version' => 1, 'steps' => $steps]);
    }

    /**
     * Steps for an array-only trace given as strings of space-separated values.
     *
     * @param string ...$rows The array after each step.
     * @return string The serialised answer.
     */
    private function arrays(string ...$rows): string {
        return $this->answer(array_map(fn($row) => ['array' => preg_split('/\s+/', trim($row))], $rows));
    }

    /**
     * Textbook traces that should each earn full marks.
     *
     * @return array
     */
    public static function textbook_trace_provider(): array {
        return [
            'bubble sort with early exit' => [
                ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8]],
                ['1 4 2 5 8', '1 2 4 5 8'],
            ],
            'bubble sort showing the final pass that makes no swaps' => [
                ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8], 'options' => ['showcheckpass' => true]],
                ['1 4 2 5 8', '1 2 4 5 8', '1 2 4 5 8'],
            ],
            'bubble sort without early exit' => [
                ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8], 'options' => ['earlyexit' => false]],
                ['1 4 2 5 8', '1 2 4 5 8', '1 2 4 5 8', '1 2 4 5 8'],
            ],
            'selection sort' => [
                ['algorithm' => 'selection_sort', 'data' => [64, 25, 12, 22, 11]],
                ['11 25 12 22 64', '11 12 25 22 64', '11 12 22 25 64', '11 12 22 25 64'],
            ],
            'insertion sort' => [
                ['algorithm' => 'insertion_sort', 'data' => [12, 11, 13, 5, 6]],
                ['11 12 13 5 6', '11 12 13 5 6', '5 11 12 13 6', '5 6 11 12 13'],
            ],
            'shell sort, Knuth gaps (Sedgewick & Wayne, Algorithms 4th ed.)' => [
                ['algorithm' => 'shell_sort', 'data' => 'S H E L L S O R T E X A M P L E'],
                ['P H E L L S O R T E X A M S L E', 'L E E A M H L E P S O L T S X R', 'A E E E H L L L M O P R S S T X'],
            ],
            'shell sort, explicit gaps' => [
                ['algorithm' => 'shell_sort', 'data' => [35, 33, 42, 10, 14, 19, 27, 44], 'options' => ['gaps' => [4, 2, 1]]],
                ['14 19 27 10 35 33 42 44', '14 10 27 19 35 33 42 44', '10 14 19 27 33 35 42 44'],
            ],
            'bottom-up merge sort (Sedgewick & Wayne)' => [
                ['algorithm' => 'merge_sort_bottom_up', 'data' => 'M E R G E S O R T E X A M P L E'],
                ['E M G R E S O R E T A X M P E L', 'E G M R E O R S A E T X E L M P',
                    'E E G M O R R S A E E L M P T X', 'A E E E E G L M M O P R R S T X'],
            ],
            'recursive merge sort' => [
                ['algorithm' => 'merge_sort', 'data' => [38, 27, 43, 3]],
                ['27 38 43 3', '27 38 3 43', '3 27 38 43'],
            ],
            'natural timsort with minrun 4' => [
                ['algorithm' => 'timsort', 'data' => [5, 6, 7, 1, 2, 9, 8, 3, 4, 10, 0]],
                ['1 5 6 7 2 9 8 3 4 10 0', '1 5 6 7 2 3 8 9 4 10 0', '1 2 3 5 6 7 8 9 4 10 0',
                    '1 2 3 5 6 7 8 9 0 4 10', '0 1 2 3 4 5 6 7 8 9 10'],
            ],
            'simplified timsort' => [
                ['algorithm' => 'timsort', 'data' => [5, 6, 7, 1, 2, 9, 8, 3, 4, 10, 0], 'options' => ['variant' => 'simplified']],
                ['1 5 6 7 2 3 8 9 0 4 10', '1 2 3 5 6 7 8 9 0 4 10', '0 1 2 3 4 5 6 7 8 9 10'],
            ],
            'Lomuto quicksort (CLRS figure 7.1 first partition)' => [
                ['algorithm' => 'quick_sort', 'data' => [2, 8, 7, 1, 3, 5, 6, 4],
                    'options' => ['partition' => 'lomuto'], 'ask' => [1]],
                ['2 1 3 4 7 5 6 8'],
            ],
            'Hoare quicksort (CLRS problem 7-1 first partition)' => [
                ['algorithm' => 'quick_sort', 'data' => [13, 19, 9, 5, 12, 8, 7, 4, 11, 2, 6, 21],
                    'options' => ['partition' => 'hoare'], 'ask' => 1],
                ['6 2 9 5 12 8 7 4 11 19 13 21'],
            ],
            'Sedgewick quicksort' => [
                ['algorithm' => 'quick_sort', 'data' => 'Q U I C K S O R T E X A M P L E', 'ask' => [1]],
                ['A E I C K L O P M E Q X T R S U'],
            ],
            '3-way quicksort' => [
                ['algorithm' => 'quick_sort', 'data' => 'R B W W R W B R R W B R', 'options' => ['partition' => 'threeway']],
                ['B B B R R R R R W W W W', 'B B B R R R R R W W W W', 'B B B R R R R R W W W W'],
            ],
            'dual-pivot quicksort' => [
                ['algorithm' => 'dual_pivot_quick_sort', 'data' => [24, 8, 42, 75, 29, 77, 38, 57]],
                ['8 24 42 38 29 57 75 77', '8 24 29 38 42 57 75 77', '8 24 29 38 42 57 75 77'],
            ],
            'LSD radix sort' => [
                ['algorithm' => 'radix_sort', 'data' => [170, 45, 75, 90, 802, 24, 2, 66]],
                ['170 90 802 2 24 45 75 66', '802 2 24 45 66 170 75 90', '2 24 45 66 75 90 170 802'],
            ],
            'final state only' => [
                ['algorithm' => 'insertion_sort', 'data' => [3, 2, 1], 'ask' => 'final'],
                ['1 2 3'],
            ],
            'a step beyond the last means the final state' => [
                ['algorithm' => 'bubble_sort', 'data' => [2, 1, 3], 'ask' => [9]],
                ['1 2 3'],
            ],
        ];
    }

    /**
     * Each textbook trace earns full marks; changing one value loses marks.
     *
     * @dataProvider textbook_trace_provider
     * @param array $uiparams The UI parameters.
     * @param array $rows The array after each step.
     */
    public function test_textbook_traces(array $uiparams, array $rows): void {
        $result = $this->grade($uiparams, $this->arrays(...$rows));
        $this->assertEquals(1.0, $result['fraction'], $result['prologuehtml']);
        $last = count($rows) - 1;
        $cells = preg_split('/\s+/', $rows[$last]);
        [$cells[0], $cells[1]] = [$cells[1], $cells[0]];
        if ($cells[0] === $cells[1]) {
            $cells[0] = 'Z';
        }
        $rows[$last] = implode(' ', $cells);
        $result = $this->grade($uiparams, $this->arrays(...$rows));
        $this->assertLessThan(1.0, $result['fraction']);
    }

    public function test_counting_sort_clrs(): void {
        $params = ['algorithm' => 'counting_sort', 'data' => [2, 5, 3, 0, 2, 3, 0, 3]];
        $answer = $this->answer([
            ['count' => [2, 0, 2, 3, 0, 1], 'output' => array_fill(0, 8, null)],
            ['count' => [2, 2, 4, 7, 7, 8], 'output' => array_fill(0, 8, null)],
            ['count' => [0, 2, 2, 4, 7, 7], 'output' => [0, 0, 2, 2, 3, 3, 3, 5]],
        ]);
        $this->assertEquals(1.0, $this->grade($params, $answer)['fraction']);
    }

    public function test_counting_sort_key_indexed(): void {
        $params = ['algorithm' => 'counting_sort', 'data' => [2, 5, 3, 0, 2, 3, 0, 3], 'options' => ['variant' => 'keyindexed'],
            'ask' => 'final', 'grade' => ['output']];
        $answer = $this->answer([['output' => [0, 0, 2, 2, 3, 3, 3, 5]]]);
        $this->assertEquals(1.0, $this->grade($params, $answer)['fraction']);
    }

    public function test_linear_search_pointers(): void {
        $params = ['algorithm' => 'linear_search', 'data' => [4, 8, 1, 9], 'target' => 1];
        $this->assertEquals(1.0, $this->grade($params, $this->answer([['i' => 0], ['i' => 1], ['i' => 2]]))['fraction']);
        $this->assertEqualsWithDelta(2 / 3, $this->grade($params, $this->answer([['i' => 0], ['i' => 1]]))['fraction'], 0.001);
    }

    public function test_binary_search_bounds(): void {
        $params = ['algorithm' => 'binary_search', 'data' => [1, 3, 5, 7, 9, 11, 13], 'target' => 11];
        $answer = $this->answer([['lo' => 0, 'mid' => 3, 'hi' => 6], ['lo' => 4, 'mid' => 5, 'hi' => 6]]);
        $this->assertEquals(1.0, $this->grade($params, $answer)['fraction']);
        $params['target'] = 4;
        $params['options'] = ['bounds' => 'exclusive'];
        $answer = $this->answer([['lo' => 0, 'mid' => 3, 'hi' => 7], ['lo' => 0, 'mid' => 1, 'hi' => 3],
            ['lo' => 2, 'mid' => 2, 'hi' => 3]]);
        $this->assertEquals(1.0, $this->grade($params, $answer)['fraction']);
        // One of three pointers wrong in one of three steps.
        $answer = $this->answer([['lo' => 0, 'mid' => 3, 'hi' => 7], ['lo' => 0, 'mid' => 2, 'hi' => 3],
            ['lo' => 2, 'mid' => 2, 'hi' => 3]]);
        $this->assertEqualsWithDelta(8 / 9, $this->grade($params, $answer)['fraction'], 0.001);
    }

    public function test_partial_credit_and_all_or_nothing(): void {
        $params = ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8]];
        $answer = $this->arrays('1 4 2 5 8', '1 4 2 5 8');
        $this->assertEquals(0.5, $this->grade($params, $answer)['fraction']);
        $this->assertEquals(0.0, $this->grade($params, $answer, true)['fraction']);
    }

    public function test_wrong_number_of_steps(): void {
        $params = ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8]];
        $result = $this->grade($params, $this->arrays('1 4 2 5 8', '1 2 4 5 8', '1 2 4 5 8', '1 2 4 5 8'));
        $this->assertEquals(0.5, $result['fraction']);
        $this->assertStringContainsString('too many', $result['prologuehtml']);
        $result = $this->grade($params, $this->arrays('1 4 2 5 8'));
        $this->assertEquals(0.5, $result['fraction']);
        $this->assertStringContainsString('too few', $result['prologuehtml']);
    }

    public function test_asked_steps_and_custom_step_name(): void {
        $params = ['algorithm' => 'selection_sort', 'data' => [64, 25, 12, 22, 11], 'ask' => [2, 4], 'stepname' => 'Pass'];
        $result = $this->grade($params, $this->arrays('11 12 25 22 64', '11 12 22 25 64'));
        $this->assertEquals(1.0, $result['fraction']);
        $result = $this->grade($params, $this->arrays('11 12 25 22 64', '11 12 22 64 25'));
        $this->assertEquals(0.5, $result['fraction']);
        $this->assertStringContainsString('Pass 4', $result['prologuehtml']);
    }

    public function test_graded_variables(): void {
        $params = ['algorithm' => 'quick_sort', 'data' => [2, 8, 7, 1, 3, 5, 6, 4],
            'options' => ['partition' => 'lomuto'], 'ask' => [1], 'grade' => ['array', 'pivot']];
        $good = $this->answer([['array' => [2, 1, 3, 4, 7, 5, 6, 8], 'pivot' => '4']]);
        $this->assertEquals(1.0, $this->grade($params, $good)['fraction']);
        $badpivot = $this->answer([['array' => [2, 1, 3, 4, 7, 5, 6, 8], 'pivot' => '8']]);
        $this->assertEquals(0.5, $this->grade($params, $badpivot)['fraction']);
        $params['options']['granularity'] = 'swap';
        $params['grade'] = ['nonsense'];
        $this->assertStringContainsString('cannot grade', $this->grade($params, $good)['prologuehtml']);
    }

    public function test_omit_unchanged_steps(): void {
        $params = ['algorithm' => 'insertion_sort', 'data' => [12, 11, 13, 5, 6], 'omitunchanged' => true];
        $result = $this->grade($params, $this->arrays('11 12 13 5 6', '5 11 12 13 6', '5 6 11 12 13'));
        $this->assertEquals(1.0, $result['fraction']);
    }

    public function test_cell_credit(): void {
        $params = ['algorithm' => 'insertion_sort', 'data' => [3, 2, 1, 4], 'ask' => 'final', 'cellcredit' => true];
        $this->assertEquals(0.5, $this->grade($params, $this->arrays('2 1 3 4'))['fraction']);
        $params['cellcredit'] = false;
        $this->assertEquals(0.0, $this->grade($params, $this->arrays('2 1 3 4'))['fraction']);
    }

    public function test_numbers_compare_loosely_and_whitespace_is_ignored(): void {
        $params = ['algorithm' => 'insertion_sort', 'data' => [3, 2, 1], 'ask' => 'final'];
        $this->assertEquals(1.0, $this->grade($params, $this->answer([['array' => [' 1', '2.0', '3 ']]]))['fraction']);
    }

    public function test_feedback_escapes_student_values(): void {
        $params = ['algorithm' => 'insertion_sort', 'data' => [3, 2, 1], 'ask' => 'final'];
        $result = $this->grade($params, $this->answer([['array' => ['<script>alert(1)</script>', '2', '3']]]));
        $this->assertStringNotContainsString('<script>', $result['prologuehtml']);
        $this->assertStringContainsString('&lt;script&gt;', $result['prologuehtml']);
    }

    public function test_feedback_detail_and_model_answer(): void {
        $params = ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8]];
        $answer = $this->arrays('1 4 2 5 8', '1 4 2 5 8');
        $detailed = $this->grade($params, $answer);
        $this->assertStringContainsString('algotrace-fbwrong', $detailed['prologuehtml']);
        $this->assertStringContainsString('Model trace', $detailed['instructorhtml']);
        $this->assertArrayNotHasKey('epiloguehtml', $detailed);
        // The correct values are not shown to students.
        $this->assertStringNotContainsString('1 2 4 5 8', strip_tags($detailed['prologuehtml']));

        $params['feedbackdetail'] = 'summary';
        $summary = $this->grade($params, $answer);
        $this->assertStringNotContainsString('algotrace-fbwrong', $summary['prologuehtml']);
        $this->assertStringContainsString('algotrace-fbbad', $summary['prologuehtml']);

        $params['feedbackdetail'] = 'minimal';
        $minimal = $this->grade($params, $answer);
        $this->assertStringNotContainsString('<table', $minimal['prologuehtml']);

        $params['showmodelanswer'] = true;
        $model = $this->grade($params, $answer);
        $this->assertStringContainsString('Model answer', $model['epiloguehtml']);
    }

    public function test_configuration_errors_are_reported(): void {
        $result = $this->grade(['algorithm' => 'nonsense', 'data' => [1, 2]], '');
        $this->assertEquals(0.0, $result['fraction']);
        $this->assertStringContainsString('unknown algorithm', $result['prologuehtml']);
        $result = $this->grade(['algorithm' => 'binary_search', 'data' => [3, 1, 2], 'target' => 1], '');
        $this->assertStringContainsString('ascending order', $result['prologuehtml']);
        $result = $this->grade(['algorithm' => 'shell_sort', 'data' => [3, 1, 2], 'options' => ['gaps' => 'odd']], '');
        $this->assertStringContainsString('option gaps', $result['prologuehtml']);
        // A gap list must shrink to 1, or the array would not end up sorted.
        foreach ([[1, 4], [2], [3, 3, 1]] as $gaps) {
            $result = $this->grade(['algorithm' => 'shell_sort', 'data' => [3, 1, 2], 'options' => ['gaps' => $gaps]], '');
            $this->assertStringContainsString('ending with 1', $result['prologuehtml']);
        }
        // Students can enter at most 500 steps, so a longer trace is a setup error.
        $result = $this->grade(['algorithm' => 'insertion_sort', 'data' => range(60, 1),
            'options' => ['granularity' => 'swap']], '');
        $this->assertStringContainsString('more than 500 steps', $result['prologuehtml']);
    }

    public function test_step_matching(): void {
        $params = ['algorithm' => 'insertion_sort', 'data' => [5, 4, 3, 2, 1]];
        $all = ['4 5 3 2 1', '3 4 5 2 1', '2 3 4 5 1', '1 2 3 4 5'];
        // Strict (the default): skipping the first step shifts every later one.
        $skipped = $this->arrays(...array_slice($all, 1));
        $this->assertEquals(0.0, $this->grade($params, $skipped)['fraction']);
        $params['stepmatching'] = 'aligned';
        $result = $this->grade($params, $skipped);
        $this->assertEquals(0.75, $result['fraction']);
        $this->assertStringContainsString('3 of 4 steps correct', $result['prologuehtml']);
        $this->assertMatchesRegularExpression('|<th>Iteration 1</th><td><em>missing</em>|', $result['prologuehtml']);
        // An extra step costs only itself, through the larger denominator.
        $extra = $this->arrays($all[0], '9 9 9 9 9', ...array_slice($all, 1));
        $this->assertEquals(0.8, $this->grade($params, $extra)['fraction']);
        $this->assertStringContainsString('Extra step 1', $this->grade($params, $extra)['prologuehtml']);
        // A wrong step is shown as wrong, not as one missing and one extra.
        $wrong = $this->arrays($all[0], '9 9 9 9 9', $all[2], $all[3]);
        $result = $this->grade($params, $wrong);
        $this->assertEquals(0.75, $result['fraction']);
        $this->assertStringNotContainsString('missing', $result['prologuehtml']);
        $this->assertEquals(1.0, $this->grade($params, $this->arrays(...$all))['fraction']);
        // With particular steps asked for, each answer box is for one step, so there is nothing to align.
        $params['ask'] = [1, 2];
        $this->assertEquals(0.0, $this->grade($params, $this->arrays($all[1], $all[0]))['fraction']);
        $params['stepmatching'] = 'fuzzy';
        $this->assertStringContainsString('stepmatching must be', $this->grade($params, $skipped)['prologuehtml']);
    }

    public function test_locked_rows_cannot_be_graded(): void {
        // The UI never sends a row students cannot change, so it could never be right.
        $result = $this->grade(['algorithm' => 'binary_search', 'data' => [1, 3, 5], 'target' => 5,
            'grade' => ['array', 'mid']], $this->answer([['mid' => 1], ['mid' => 2]]));
        $this->assertEquals(0.0, $result['fraction']);
        $this->assertStringContainsString('cannot grade &quot;array&quot;, because students cannot change it',
            $result['prologuehtml']);
    }

    public function test_teachers_are_told_about_unusual_traces(): void {
        // A step past the end of the trace means the final state, and teachers are told.
        $result = $this->grade(['algorithm' => 'bubble_sort', 'data' => [2, 1, 3], 'ask' => [9]], $this->arrays('1 2 3'));
        $this->assertEquals(1.0, $result['fraction']);
        $this->assertStringContainsString('only 1 step for this data, so asking for Iteration 9 gives the final state',
            $result['instructorhtml']);
        $this->assertStringNotContainsString('final state', $result['prologuehtml']);
        // Data the algorithm makes no steps for: the correct answer is an empty trace.
        $params = ['algorithm' => 'bubble_sort', 'data' => [1, 2, 3]];
        $result = $this->grade($params, $this->answer([]));
        $this->assertEquals(1.0, $result['fraction']);
        $this->assertStringContainsString('makes no steps for this data', $result['instructorhtml']);
        // With the model answer shown to students, the notes are still for teachers only.
        $params['showmodelanswer'] = true;
        $result = $this->grade($params, $this->answer([]));
        $this->assertStringContainsString('makes no steps for this data', $result['instructorhtml']);
        $this->assertStringNotContainsString('makes no steps for this data', $result['prologuehtml']);
    }

    public function test_bad_student_answer_scores_zero(): void {
        $params = ['algorithm' => 'bubble_sort', 'data' => [2, 1]];
        $result = $this->grade($params, '{"type": "something-else"}');
        $this->assertEquals(0.0, $result['fraction']);
        $this->assertStringContainsString('not an algorithm trace', $result['prologuehtml']);
    }

    public function test_custom_algorithm_from_support_file(): void {
        if (!self::available('python3')) {
            $this->markTestSkipped('This test needs a local python3');
        }
        $dir = make_request_directory();
        file_put_contents($dir . '/algorithm.py', implode("\n", [
            'def trace(data, options):',
            '    best = 0',
            '    for i, value in enumerate(data):',
            '        if value > data[best]:',
            '            best = i',
            '        yield {"i": i, "best": data[best]}',
        ]));
        $params = ['algorithm' => 'custom', 'data' => [3, 7, 5], 'schema' => ['rows' => [['name' => 'array', 'editable' => false]],
            'pointers' => ['i'], 'vars' => ['best']]];
        $answer = $this->answer([['i' => 0, 'best' => '3'], ['i' => 1, 'best' => '7'], ['i' => 2, 'best' => '7']]);
        $this->assertEquals(1.0, $this->grade($params, $answer, false, $dir)['fraction']);
        $missing = $this->grade($params, $answer, false, make_request_directory());
        $this->assertStringContainsString('algorithm.py', $missing['prologuehtml']);

        // The schema's grade may be a string, as the grade UI parameter may.
        $params['schema']['grade'] = 'i, best';
        $this->assertEquals(1.0, $this->grade($params, $answer, false, $dir)['fraction']);

        // Errors in the author's code are reported as setup errors, not tracebacks.
        $broken = make_request_directory();
        file_put_contents($broken . '/algorithm.py', "def trace(data, options):\n    yield {'i': 0}\n    1 / 0\n");
        $result = $this->grade($params, $answer, false, $broken);
        $this->assertStringContainsString('not set up correctly: trace() in algorithm.py failed (ZeroDivisionError',
            $result['prologuehtml']);
        file_put_contents($broken . '/algorithm.py', "def trace(data, options:\n");
        $result = $this->grade($params, $answer, false, $broken);
        $this->assertStringContainsString('algorithm.py could not be loaded (SyntaxError', $result['prologuehtml']);
    }

    public function test_ui_parameter_defaults_match_the_grader(): void {
        global $CFG;
        $json = json_decode(file_get_contents($CFG->dirroot . '/question/type/coderunner/amd/src/ui_algorithmtrace.json'), true);
        $defaults = array_map(fn($param) => $param['default'], $json['parameters']);
        $output = $this->run_python($this->python_library() . "\nprint(json.dumps(DEFAULTS))\n");
        $grader = json_decode($output, true);
        ksort($defaults);
        ksort($grader);
        // JSON decodes empty objects as arrays in PHP, so compare after encoding.
        $this->assertEquals(json_encode($defaults), json_encode($grader));
        // The grading settings' defaults are the prototype's template parameters.
        $output = $this->run_python($this->python_library() . "\nprint(json.dumps(TEMPLATE_DEFAULTS))\n");
        $this->assertEquals(json_decode($this->prototype_field('templateparams'), true), json_decode($output, true));
        $this->assertEqualsCanonicalizing(self::TEMPLATE_SETTINGS, array_keys(json_decode($output, true)));
    }

    public function test_grading_settings_in_ui_parameters_are_ignored(): void {
        $q = $this->make_trace_question(['algorithm' => 'bubble_sort', 'data' => [2, 1], 'showmodelanswer' => true]);
        $q->parameters = (object)[];
        $program = $q->twig_expand($q->template, ['STUDENT_ANSWER' => $this->arrays('1 2'), 'IS_PRECHECK' => '0',
            'TESTCASES' => []]);
        $result = json_decode($this->run_python($program), true);
        $this->assertEquals(1.0, $result['fraction']);
        $this->assertArrayNotHasKey('epiloguehtml', $result);
    }

    public function test_ui_schemas_match_the_grader(): void {
        global $CFG;
        if (!self::available('node') || !self::available('python3')) {
            $this->markTestSkipped('This test needs node and python3');
        }
        $cases = [
            ['linear_search', [], [4, 8, 1, 9], null],
            ['binary_search', ['bounds' => 'exclusive'], [1, 3, 5], null],
            ['binary_search', [], [1, 3, 5], null],
            ['bubble_sort', [], [3, 1, 2], null],
            ['selection_sort', [], 'C A B', null],
            ['insertion_sort', [], [3, 1, 2], null],
            ['shell_sort', [], [3, 1, 2], null],
            ['merge_sort', [], [3, 1, 2], null],
            ['merge_sort_bottom_up', [], [3, 1, 2], null],
            ['timsort', [], [3, 1, 2], null],
            ['quick_sort', [], [3, 1, 2], null],
            ['dual_pivot_quick_sort', [], [3, 1, 2], null],
            ['radix_sort', [], [30, 1, 2], null],
            ['counting_sort', [], [2, 5, 3, 0], null],
            ['counting_sort', ['variant' => 'keyindexed'], [2, 5, 3, 0], null],
            ['counting_sort', ['min' => 'data', 'max' => 9], [2, 5, 3], null],
            ['custom', [], [1, 2, 3], ['rows' => [['name' => 'array'], ['name' => 'aux', 'length' => 2, 'init' => 'blank']],
                'pointers' => ['i'], 'vars' => ['min']]],
        ];
        $dir = make_request_directory();
        file_put_contents($dir . '/cases.json', json_encode($cases));
        file_put_contents($dir . '/schemas.js', implode("\n", [
            'global.define = (deps, factory) => { module.exports = factory({get_strings: () => Promise.resolve([])}); };',
            'require(' . json_encode($CFG->dirroot . '/question/type/coderunner/amd/src/ui_algorithmtrace.js') . ');',
            'const ui = module.exports;',
            'const cases = JSON.parse(require("fs").readFileSync(' . json_encode($dir . '/cases.json') . ', "utf8"));',
            'console.log(JSON.stringify(cases.map(([a, o, d, s]) => ui.schemaFor(a, o, ui.parseData(d), s))));',
        ]));
        $jsoutput = shell_exec('node ' . escapeshellarg($dir . '/schemas.js'));
        $python = $this->python_library() . "\ncases = json.loads(" . var_export(json_encode($cases), true) . ")\n" .
            "print(json.dumps([custom_schema(s, parse_data(d)) if a == 'custom' else " .
            "builtin_schema(a, o or {}, parse_data(d)) for a, o, d, s in cases]))\n";
        $pyoutput = $this->run_python($python);
        $this->assertEquals(json_decode($pyoutput, true), json_decode($jsoutput, true));
    }

    public function test_ui_reads_data_as_the_grader_does(): void {
        global $CFG;
        if (!self::available('node') || !self::available('python3')) {
            $this->markTestSkipped('This test needs node and python3');
        }
        $cases = [[3, '1', ' 2 '], '5 1e3 .5 5. -2 +7', ['0x10', '5'], ['1_000', '2'], ['inf', '1'], [true, 'a', 2.0],
            [1.5, 'b'], 'B A C', '[3, 1, 2]', [1, null, 'a'], [[1], 'a'], '[1, 2', ''];
        $dir = make_request_directory();
        file_put_contents($dir . '/cases.json', json_encode($cases));
        file_put_contents($dir . '/data.js', implode("\n", [
            'global.define = (deps, factory) => { module.exports = factory({get_strings: () => Promise.resolve([])}); };',
            'require(' . json_encode($CFG->dirroot . '/question/type/coderunner/amd/src/ui_algorithmtrace.js') . ');',
            'const ui = module.exports;',
            'const cases = JSON.parse(require("fs").readFileSync(' . json_encode($dir . '/cases.json') . ', "utf8"));',
            'console.log(JSON.stringify(cases.map((c) => { try { return ui.parseData(c); } catch (e) { return "error"; } })));',
        ]));
        $jsoutput = shell_exec('node ' . escapeshellarg($dir . '/data.js'));
        $python = $this->python_library() . "\ncases = json.loads(" . var_export(json_encode($cases), true) . ")\n" .
            "def parse(case):\n    try:\n        return parse_data(case)\n    except TraceError:\n        return 'error'\n" .
            "print(json.dumps([parse(case) for case in cases]))\n";
        $pyoutput = $this->run_python($python);
        $this->assertSame(json_encode(json_decode($pyoutput, true)), json_encode(json_decode($jsoutput, true)));
    }

    public function test_randomised_data_reaches_the_ui_and_the_grader(): void {
        $q = $this->make_trace_question([]);
        // Template parameters may not use UI parameter names, so the random values
        // get their own name and Twig puts them into the UI parameters.
        $q->templateparams = '{"randomdata": {{ range(10, 99)|shuffle|slice(0, 6)|json_encode }}}';
        $q->uiparameters = '{"algorithm": "bubble_sort", "data": {{ randomdata|json_encode }}, "ask": "final"}';
        $q->twigall = 1;
        $q->hoisttemplateparams = 1;
        unset($q->mergeduiparameters);
        $q->start_attempt();
        $params = $q->mergeduiparameters;
        $this->assertEquals('bubble_sort', $params['algorithm']);
        $this->assertCount(6, $params['data']);
        $sorted = $params['data'];
        sort($sorted);
        // At grading time QUESTION.uiparameters is the merged UI parameters.
        $program = $q->twig_expand($q->template, [
            'STUDENT_ANSWER' => $this->arrays(implode(' ', $sorted)),
            'IS_PRECHECK' => '0',
            'TESTCASES' => [],
        ]);
        $result = json_decode($this->run_python($program), true);
        $this->assertEquals(1.0, $result['fraction'], $result['prologuehtml'] ?? '');
    }

    /**
     * The correct serialised answer for the given merged UI parameters.
     *
     * @param array $uiparams The merged UI parameters.
     * @return string
     */
    private function model_answer(array $uiparams): string {
        $python = $this->python_library() . "\n" . implode("\n", [
            'config = load_config(' . var_export(json_encode($uiparams), true) . ')',
            'schema, initial, frames = compute_trace(config)',
            'components = graded_components(schema, config.get("grade"))',
            'if bool_option(config, "omitunchanged", False):',
            '    frames = omit_unchanged(initial, frames, components)',
            'steps = expected_steps(parse_ask(config.get("ask")), initial, frames, "Step")',
            'out = [{name: ([show(v) for v in frame[name]] if kind == "row" else frame[name] if kind == "pointer" ' .
                'else show(frame[name])) for name, kind in components} for _, frame in steps]',
            'print(json.dumps({"type": SERIALISATION_TYPE, "version": 1, "steps": out}))',
        ]) . "\n";
        return trim($this->run_python($python));
    }

    public function test_demo_questions_import_and_grade(): void {
        global $CFG;
        require_once($CFG->dirroot . '/question/format/xml/format.php');
        $course = $this->getDataGenerator()->create_course();
        $qformat = new \qformat_xml();
        $qformat->setCategory($this->category);
        $qformat->setContexts([\context::instance_by_id($this->category->contextid)]);
        $qformat->setCourse($course);
        $qformat->setFilename($CFG->dirroot . '/question/type/coderunner/samples/algorithmtracedemoquestions.xml');
        $qformat->setRealfilename('algorithmtracedemoquestions.xml');
        $qformat->setMatchgrades('error');
        $qformat->setCatfromfile(false);
        $qformat->setContextfromfile(false);
        $qformat->setStoponerror(true);
        ob_start();
        $this->assertTrue($qformat->importpreprocess());
        $this->assertTrue($qformat->importprocess());
        ob_end_clean();
        $this->assertCount(7, $qformat->questionids);

        foreach ($qformat->questionids as $id) {
            $q = \question_bank::load_question($id);
            $q->start_attempt();
            $this->assertEmpty($q->initialisationerrormessage, $q->name);
            $params = $q->mergeduiparameters;
            $this->assertEquals('algorithmtrace', $q->uiplugin, $q->name);
            $this->assertNotEmpty($params['data'], $q->name);
            $template = $q->template;
            $this->assertStringContainsString('grade_answer', $template, $q->name . ' should inherit the prototype template');
            $expand = fn($answer) => $q->twig_expand($template, ['STUDENT_ANSWER' => $answer, 'IS_PRECHECK' => '0',
                'TESTCASES' => []]);
            $model = $this->model_answer($params);
            $result = json_decode($this->run_python($expand($model)), true);
            $this->assertEquals(1.0, $result['fraction'], $q->name . ': ' . ($result['prologuehtml'] ?? ''));
            $wrong = json_decode($model, true);
            $first = array_key_first($wrong['steps'][0]);
            $wrong['steps'][0][$first] = is_array($wrong['steps'][0][$first]) ? array_reverse($wrong['steps'][0][$first]) : 99;
            $result = json_decode($this->run_python($expand(json_encode($wrong))), true);
            $this->assertLessThan(1.0, $result['fraction'], $q->name);
        }
    }

    public function test_fill_answer_service_needs_question_editing_rights(): void {
        $course = $this->getDataGenerator()->create_course();
        $student = $this->getDataGenerator()->create_and_enrol($course, 'student');
        $this->setUser($student);
        $this->expectException(\required_capability_exception::class);
        external\algorithm_trace_answer::execute(\context_course::instance($course->id)->id,
            json_encode(['algorithm' => 'bubble_sort', 'data' => [2, 1]]), '', 0);
    }

    public function test_fill_answer_service_returns_the_correct_answer(): void {
        self::setup_test_sandbox_configuration();
        if (\qtype_coderunner_sandbox::get_best_sandbox('python3') === null) {
            $this->markTestSkipped('No python3 sandbox is available');
        }
        $course = $this->getDataGenerator()->create_course();
        $contextid = \context_course::instance($course->id)->id;
        $params = ['algorithm' => 'bubble_sort', 'data' => [5, 1, 4, 2, 8]];
        $result = external\algorithm_trace_answer::execute($contextid, json_encode($params), '', 0);
        $this->assertSame('', $result['error']);
        $this->assertEquals(2, $result['steps']);
        $this->assertEquals(1.0, $this->grade($params, $result['answer'])['fraction']);
        $first = external\algorithm_trace_answer::execute($contextid, json_encode($params), '', 1);
        $this->assertEquals(1, $first['steps']);
        $insertion = ['algorithm' => 'insertion_sort', 'data' => [12, 11, 13, 5, 6]];
        $omit = external\algorithm_trace_answer::execute($contextid, json_encode($insertion), '{"omitunchanged": true}', 0);
        $this->assertEquals(3, $omit['steps']);
        // Template parameters written over several lines, with quotes and backslashes.
        $multiline = "{\n    \"omitunchanged\": true,\n    \"note\": \"it's a \\\\ test\"\n}";
        $omit = external\algorithm_trace_answer::execute($contextid, json_encode($insertion), $multiline, 0);
        $this->assertSame('', $omit['error']);
        $this->assertEquals(3, $omit['steps']);
        // Twig that makes JSON is rendered first; anything else is an error, not silently ignored.
        $twig = "{% set omit = true %}\n{\"omitunchanged\": {{ omit ? 'true' : 'false' }}}";
        $this->assertEquals(3, external\algorithm_trace_answer::execute($contextid, json_encode($insertion), $twig, 0)['steps']);
        foreach (['omitunchanged = True', '{{ nonsense(', '[1, 2]'] as $bad) {
            $result = external\algorithm_trace_answer::execute($contextid, json_encode($insertion), $bad, 0);
            $this->assertStringContainsString('template parameters could not be read', $result['error'], $bad);
        }
        $bad = external\algorithm_trace_answer::execute($contextid, json_encode(['algorithm' => 'nope', 'data' => [1]]), '', 0);
        $this->assertStringContainsString('unknown algorithm', $bad['error']);
        // Warnings for the author.
        $past = external\algorithm_trace_answer::execute($contextid,
            json_encode(['algorithm' => 'bubble_sort', 'data' => [2, 1, 3], 'ask' => [5]]), '', 0);
        $this->assertSame('', $past['error']);
        $this->assertStringContainsString('gives the final state', $past['warning']);
        $this->assertSame('', external\algorithm_trace_answer::execute($contextid, json_encode($params), '', 0)['warning']);
    }

    public function test_prototype_ui_parameters_are_valid(): void {
        $uiparams = new \qtype_coderunner_ui_parameters('algorithmtrace');
        $uiparams->merge_json($this->prototype_field('uiparameters'));
        $this->assertEquals('bubble_sort', $uiparams->value('algorithm'));
    }
}
