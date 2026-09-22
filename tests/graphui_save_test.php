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
 * A simple test that the graph_ui info is saved correctly.
 * Refactored from questiontype_test.php where it used to reside.
 * @group qtype_coderunner
 *
 * @package    qtype
 * @subpackage coderunner
 * @copyright  2020, 2021 Richard Lobb, University of Canterbury
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace qtype_coderunner;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/question/type/coderunner/tests/test.php');
require_once($CFG->dirroot . '/question/type/coderunner/questiontype.php');
require_once($CFG->dirroot . '/question/type/edit_question_form.php');
require_once($CFG->dirroot . '/question/type/coderunner/edit_coderunner_form.php');

/**
 * @coversNothing
 */
class graphui_save_test extends \qtype_coderunner_testcase {
    protected $qtype;

    protected function setUp(): void {
        $this->resetAfterTest(true);
        $this->qtype = new \qtype_coderunner();
    }

    public function test_question_saving_graph_ui() {
        $this->assert_question_saves_with_ui('graph');
    }

    public function test_question_saving_datastructuregraph_ui() {
        $this->assert_question_saves_with_ui('datastructuregraph');
    }

    public function test_question_saving_datastructuregraph_answer() {
        $this->assert_question_saves_with_ui('datastructuregraph', $this->datastructuregraph_answer_json());
    }

    /**
     * Assert that a question saves with the given UI plugin.
     *
     * @param string $uiplugin UI plugin name.
     * @param string|null $answer optional sample answer.
     */
    private function assert_question_saves_with_ui(string $uiplugin, ?string $answer = null): void {
        $this->setAdminUser();

        $questiondata = \test_question_maker::get_question_data('coderunner');
        $questiondata->options->uiplugin = $uiplugin;
        $formdata = \test_question_maker::get_question_form_data('coderunner');
        $formdata->uiplugin = $uiplugin;
        if ($answer !== null) {
            $questiondata->options->answer = $answer;
            $questiondata->options->validateonsave = 0;
            $formdata->answer = $answer;
            $formdata->validateonsave = 0;
        }

        $generator = $this->getDataGenerator()->get_plugin_generator('core_question');
        $cat = $generator->create_question_category([]);

        // Mock submit a form with form data.
        $formdata->category = "{$cat->id},{$cat->contextid}";
        \qtype_coderunner_edit_form::mock_submit((array)$formdata);

        $form = \qtype_coderunner_test_helper::get_question_editing_form($cat, $questiondata);
        $this->assertTrue($form->is_validated());

        $fromform = $form->get_data();
        $returnedfromsave = $this->qtype->save_question($questiondata, $fromform);

        $actualquestionsdata = question_load_questions([$returnedfromsave->id]);
        $actualquestiondata = end($actualquestionsdata);

        foreach ($questiondata as $property => $value) {
            if (
                !in_array($property, ['id', 'idnumber', 'version', 'timemodified',
                'timecreated', 'options', 'testcases'])
            ) {
                $this->assertEquals($value, $actualquestiondata->$property);
            }
        }

        foreach ($questiondata->options as $optionname => $value) {
            if ($optionname != 'testcases') {
                $this->assertEquals(
                    $value,
                    $actualquestiondata->options->$optionname,
                    'For property ' . $optionname
                );
            }
        }

        // TODO: Validate the test cases.
    }

    /**
     * Return a sample data-structure graph serialisation.
     *
     * @return string
     */
    private function datastructuregraph_answer_json(): string {
        return json_encode([
            'type' => 'coderunner-datastructure-graph',
            'version' => 1,
            'settings' => [
                'mode' => 'tree',
                'isdirected' => false,
                'childslots' => ['left', 'right'],
                'nodefields' => 'key_value',
                'maxnodekeys' => 0,
            ],
            'nodes' => [
                ['id' => 'n1', 'key' => '10', 'value' => '', 'layout' => ['x' => 100, 'y' => 40]],
                ['id' => 'n2', 'key' => '5', 'value' => '', 'layout' => ['x' => 60, 'y' => 120]],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'n1', 'to' => 'n2', 'cost' => '', 'color' => 'black', 'slot' => 'left'],
            ],
        ]);
    }
}
